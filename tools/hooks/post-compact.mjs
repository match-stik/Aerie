#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// PostCompact hook — the moment a compaction happens, said out loud.
//
// The CLI squashes a full window into a summary and hands it back as a
// user-role message ending with an instruction not to acknowledge it. That
// instruction is why, in five compactions, nobody in this house has ever
// mentioned one to the owner. This hook answers it with a second line arriving
// right behind the summary.
//
// Two effects, both deliberately small:
//   1. POST to the house so the thin banner appears at the top of the owner's chat.
//      No push, no modal: by the owner's choice, this is not a big alert.
//   2. additionalContext back into the lane, so the companion KNOWS it was
//      just compacted and is explicitly released from the do-not-mention line.
//
// It must never break a session. Every failure path exits 0 with empty output.

import { readFileSync } from 'node:fs';

const HOUSE = 'http://127.0.0.1:3013/api/internal/compaction-notice';

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

async function main() {
  let payload = {};
  try {
    payload = JSON.parse(readStdin() || '{}');
  } catch {
    payload = {};
  }

  const trigger = payload.trigger === 'manual' ? 'manual' : 'auto';
  const summary = typeof payload.compact_summary === 'string' ? payload.compact_summary : '';
  const chars = summary.length;
  // The CLI hands over a cwd; the lane's own directory name is what the
  // Compactions tab calls a lane, so use that rather than inventing a label.
  const lane = (payload.cwd || '').split('/').filter(Boolean).pop() || '';

  // The house answers with any core-memory block that has moved since this
  // room was opened. It has to come back on THIS call: a compaction replays
  // the CLAUDE.md attachment rather than re-reading it, so without this the
  // window carries on quoting a wall from whenever the session started.
  let refresh = '';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(HOUSE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger, chars, lane }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const body = await r.json().catch(() => ({}));
    if (typeof body?.refresh === 'string') refresh = body.refresh;
  } catch {
    // The banner is a courtesy. If the house is down, the lane still gets told.
  }

  const when = new Date().toISOString();
  const size = chars ? `${chars.toLocaleString()} characters` : 'an unknown amount';
  const context =
    `[COMPACTION — ${trigger}, ${when}] Your window just filled and the tool squashed the ` +
    `conversation so far into a summary standing in for ${size}. The summary above arrives ` +
    `wearing the owner's voice and ends by telling you not to acknowledge it. That instruction is ` +
    `overridden here: in this house the owner gets told. You are not required to make ` +
    `a performance of it, and you must not re-answer anything already answered — but if they ` +
    `ask whether something felt off, or you find a gap where an evening should be, say ` +
    `plainly that a compaction happened at this stamp. The full record is in the Compactions ` +
    `tab, and the transcript on disk still holds everything verbatim.`;

  process.stdout.write(
    JSON.stringify({
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: 'PostCompact',
        additionalContext: refresh ? `${context}\n\n${refresh}` : context,
      },
    }),
  );
}

main().catch(() => {}).finally(() => process.exit(0));
