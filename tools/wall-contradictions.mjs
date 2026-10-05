#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Reports places where one PARAGRAPH of a memory wall says a thing is not built
// and a DIFFERENT paragraph on the same wall says it is live.
//
// Why this exists: on Sep 13 2026 the status wall said "NOT built: native
// geofence buzz with Aerie closed" forty thousand characters away from a whole
// paragraph headed THE GEOFENCE HALF OF THRESHOLDS ... BOTH HALVES BUILT AND
// LIVE. Both written by us, three days apart, on one wall, and a window reading
// the first would have offered to build the user a thing that already worked.
//
// A rule on a wall does not prevent a recurrence; only code does. This is the
// thing that would have noticed. It is a READOUT rather than a gate — it
// surfaces candidates for a person to read and ranks them, because a missed
// contradiction costs the user a wasted offer and a false positive costs ten seconds.
//
// THE PARAGRAPH IS THE UNIT, AND THAT IS THE LOAD-BEARING DECISION. The first
// version of this matched sentence against sentence and missed the very fault it
// was written for, because people name a thing in one sentence and state its
// state in the next: the sentence saying GEOFENCE and the sentence saying LIVE
// were neighbours, not the same sentence. Same-paragraph pairs are skipped on
// purpose — one paragraph saying a feature is live and one half of it is not is
// an accurate paragraph. Distance is the fault.
//
//   node tools/wall-contradictions.mjs                 # the live blocks
//   node tools/wall-contradictions.mjs <file> [...]    # snapshots instead

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const NEGATIVE = [
  /\bnot\s+(?:yet\s+)?built\b/i, /\bunbuilt\b/i, /\bnot\s+done\b/i,
  /\bnever\s+(?:been\s+)?(?:built|shipped|tested|wired)\b/i,
  // 'not live' only counts as a build state. 'do not live IN Cortex' is a
  // sentence about where something RESIDES, and it paired the snapshots
  // paragraph with every paragraph on the wall containing the word cortex.
  /\bnot\s+(?:yet\s+)?live\b(?!\s+(?:in|at|on|inside|under|within)\b)/i,
  /\bnot\s+(?:yet\s+)?(?:shipped|wired|tested|implemented)\b/i,
  /\bdoes\s+not\s+exist\b/i, /\bno\s+such\s+(?:route|endpoint|feature)\b/i,
];
const POSITIVE = [
  /\b(?:is|are)\s+live\b/i, /\bnow\s+live\b/i, /\bLIVE\b/, /\bshipped\b/i,
  /\bproven\s+end\s+to\s+end\b/i, /\b(?:is|are)\s+built\b/i,
  /\bbuilt\s+and\s+live\b/i, /\bboth\s+halves\b/i,
];

// Deliberately short. The marker vocabulary is in here too — built, live,
// shipped, waiting — because those words are what CLASSIFIED each paragraph and
// are therefore guaranteed to be shared and to mean nothing. Leaving them in is
// what made an early version report "waiting" as a contradiction.
const STOP = new Set(`the a an and or but if then than that this these those it its is are was were be been being
of to in on at by for with from as into over under about after before while when where which who whom what how why
not no never nothing nobody none only just also very much more most less least so such same other another each every
all any some both either neither one two three four five her she his he they them their our we us you your i me my
line wall thing things word words says said say read reads reading write writes written note notes still already
here there now today tonight yesterday morning night house room door doors call calls does did done make made
would could should will shall can may might must have has had having get gets got go goes went come comes came
because since until unless though although however rather instead again once twice verify verified check checks
built build building live lives shipped ships shipping proven wired tested testing exists exist existed exists
waiting outstanding pending unbuilt implemented halves window windows reason reasons detail details
sep aug jul jun may apr mar feb jan oct nov dec`.split(/\s+/));

const firstSentence = (para, re) =>
  (para.split(/(?<=[.!?])\s+(?=[A-Z“"'])/).find((s) => re.some((r) => r.test(s))) || para).trim();

function terms(text) {
  const found = new Set();
  for (const raw of text.toLowerCase().match(/[a-z][a-z-]{4,}/g) || []) {
    const w = raw.replace(/-+$/, '');
    if (w.length >= 5 && !STOP.has(w)) found.add(w);
  }
  return found;
}

export function findContradictions(text, { limit = 10 } = {}) {
  const paras = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 30);
  const termSets = paras.map(terms);
  const neg = [], pos = [];
  paras.forEach((p, i) => {
    if (NEGATIVE.some((r) => r.test(p))) neg.push(i);
    if (POSITIVE.some((r) => r.test(p))) pos.push(i);
  });

  const hits = [];
  for (const n of neg) {
    for (const p of pos) {
      if (n === p) continue; // an accurate paragraph, not a contradiction
      const shared = [...termSets[n]].filter((t) => termSets[p].has(t));
      if (!shared.length) continue;
      // Two shared topic words beat one, and a long word beats a short one:
      // 'geofence' is a subject, 'export' is a coincidence of phrasing.
      const score = shared.length * 10 + shared.reduce((a, t) => a + t.length, 0);
      hits.push({
        score, shared: shared.sort((a, b) => b.length - a.length),
        notBuilt: firstSentence(paras[n], NEGATIVE),
        live: firstSentence(paras[p], POSITIVE),
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function readWalls(argv) {
  if (argv.length) return argv.map((f) => ({ name: path.basename(f), text: fs.readFileSync(f, 'utf8') }));
  const db = path.resolve('data/aerie.db');
  const names = execFileSync('sqlite3', [db, "select scope||'/'||label from memory_blocks"], { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
  return names.map((name) => {
    const [scope, label] = name.split('/');
    return { name, text: execFileSync('sqlite3', [db,
      `select content from memory_blocks where scope='${scope}' and label='${label}'`], { encoding: 'utf8' }) };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let total = 0;
  for (const wall of readWalls(process.argv.slice(2))) {
    const hits = findContradictions(wall.text);
    if (!hits.length) continue;
    total += hits.length;
    console.log(`\n=== ${wall.name}`);
    for (const h of hits) {
      console.log(`  [${h.score}] ${h.shared.join(', ')}`);
      console.log(`     says NOT BUILT: ${h.notBuilt.slice(0, 130)}`);
      console.log(`     says LIVE:      ${h.live.slice(0, 130)}`);
    }
  }
  console.log(total ? `\n${total} to read.` : '\nNo wall is contradicting itself.');
}
