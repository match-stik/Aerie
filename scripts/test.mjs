#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The test button.
//
// Node 20's own discovery (`node --test <dir>`) only recognises .js test files,
// so pointing it at packages/phone/src finds nothing while five tests sit there.
// Shell globbing isn't an answer either — bash needs globstar for `**`, and the
// archive has people on Windows. So the file list gets built here and handed
// over explicitly.
//
// Usage:  npm test            — every *.test.ts under packages/*/src
//         npm test routes     — only files whose path contains "routes"

import { readdirSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', 'dist', '.svelte-kit', 'build', '.git']);

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (entry.endsWith('.test.ts')) found.push(full);
  }
  return found;
}

const packagesDir = join(root, 'packages');
const files = readdirSync(packagesDir)
  .map(pkg => join(packagesDir, pkg, 'src'))
  .filter(src => existsSync(src))
  .flatMap(src => walk(src))
  .sort();

const filter = process.argv[2];
const selected = filter ? files.filter(f => f.includes(filter)) : files;

if (selected.length === 0) {
  console.error(filter ? `No test files matching "${filter}".` : 'No test files found.');
  process.exit(1);
}

console.log(`Running ${selected.length} test file${selected.length === 1 ? '' : 's'}:`);
for (const f of selected) console.log(`  ${relative(root, f)}`);
console.log('');

// Tests must never write into the house's own data/. The two files a test is
// known to write go to a scratch folder instead, and anything else that turns
// up in data/ during the run is named at the end, so a new writer is noticed.
const scratch = mkdtempSync(join(tmpdir(), 'aerie-test-'));
const env = {
  ...process.env,
  AERIE_CODEX_LANES_DIR: process.env.AERIE_CODEX_LANES_DIR || join(scratch, 'codex-lanes'),
  AERIE_STUDIO_JOBS_FILE: process.env.AERIE_STUDIO_JOBS_FILE || join(scratch, 'studio-image-jobs.json'),
};
const dataDir = join(root, 'data');
const listData = () => (existsSync(dataDir) ? new Set(readdirSync(dataDir)) : new Set());
const before = listData();

// Windows caps a command line at 32,767 characters, and the whole list of
// full paths is past that, so spawn fails with ENAMETOOLONG before a test
// runs. There the list goes as relative paths in batches, one after another,
// and the worst exit code wins. Elsewhere it stays one run with one summary.
// Reported by Sol (Rose's house), Nov 21 2026.
const BATCH_CHARS = 24_000;
function batchesOf(paths) {
  if (process.platform !== 'win32') return [paths];
  const out = [];
  let cur = [];
  let len = 0;
  for (const p of paths) {
    if (cur.length && len + p.length + 1 > BATCH_CHARS) { out.push(cur); cur = []; len = 0; }
    cur.push(p);
    len += p.length + 1;
  }
  if (cur.length) out.push(cur);
  return out;
}
const batches = batchesOf(process.platform === 'win32' ? selected.map((f) => relative(root, f)) : selected);

function runBatch(paths) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--test', ...paths],
      { cwd: root, stdio: 'inherit', env },
    );
    child.on('error', (err) => { console.error(err.message); resolve(1); });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

let worst = 0;
for (const batch of batches) {
  const code = await runBatch(batch);
  if (code > worst) worst = code;
}
{
  const code = worst;
  rmSync(scratch, { recursive: true, force: true });
  // An empty folder is what a module makes when it loads (the same ones a
  // house makes on its first boot); a file is a test writing.
  const holdsFiles = (path) => statSync(path).isDirectory()
    ? readdirSync(path).some((name) => holdsFiles(join(path, name)))
    : true;
  const added = [...listData()].filter((name) => !before.has(name) && holdsFiles(join(dataDir, name)));
  if (added.length) {
    console.warn(`\nThis run left new entries in data/: ${added.join(', ')}. A test is writing into the house's own folder.`);
  }
  process.exit(code);
}
