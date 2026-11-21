#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Open a sealed backup (services/sealed-backup.ts) back into a database file.
//
//   node tools/backup/open-backup.mjs <aerie-backup-....sealed> <restored.db>
//
// It asks for the phrase on its own line (read from the terminal, never the
// command line, where other accounts could see it). Run it from a built house
// (npm run build in packages/backend). It refuses a wrong phrase, a changed
// file and a cut-short one, and never writes over a file that is already there.
// To put the house back: stop it, keep the old data/aerie.db somewhere, put the
// restored file in its place (and delete any aerie.db-wal and aerie.db-shm
// beside it), and start it again. Logins are not in a backup, so sign in again.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const [, , sealedPath, outPath] = process.argv;
if (!sealedPath || !outPath) {
  console.error('Usage: node tools/backup/open-backup.mjs <file.sealed> <restored.db>');
  process.exit(2);
}
if (existsSync(outPath)) {
  console.error(`${outPath} is already there; pick a new name.`);
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, '..', '..', 'packages', 'backend', 'dist', 'services', 'sealed-backup.js');
if (!existsSync(lib)) {
  console.error('Build the backend first (npm run build in packages/backend).');
  process.exit(2);
}
const { keysFromPhrase, openSealed } = await import(lib);

const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
const phrase = await new Promise((resolve) => rl.question('Backup phrase: ', (a) => { rl.close(); resolve(a); }));

try {
  const opened = gunzipSync(openSealed(readFileSync(sealedPath), keysFromPhrase(phrase).privateKey));
  if (!opened.subarray(0, 15).equals(Buffer.from('SQLite format 3'))) throw new Error('It opened, but what is inside is not a database.');
  writeFileSync(outPath, opened, { mode: 0o600, flag: 'wx' });
  console.error(`Opened: ${outPath} (${opened.length} bytes).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
