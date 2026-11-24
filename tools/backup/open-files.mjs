#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Open the files half of a sealed backup (services/sealed-files.ts): the
// laptop's Documents\Aerie Backups\files folder, one .sealed file per upload
// or picture, back into a plain folder tree.
//
//   node tools/backup/open-files.mjs <...\Aerie Backups\files> <out folder>
//
// It asks for the same phrase as the database backup, on its own line, and
// never writes over a file that is already there. To put the pictures back,
// copy out/files into data/files and out/generated-images into
// data/generated-images on the house.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const [, , inDir, outDir] = process.argv;
if (!inDir || !outDir) {
  console.error('Usage: node tools/backup/open-files.mjs <sealed files folder> <out folder>');
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
const { privateKey } = keysFromPhrase(phrase);

let opened = 0;
let failed = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) { walk(abs); continue; }
    if (!name.endsWith('.sealed')) continue;
    const target = join(outDir, relative(inDir, abs).replace(/\.sealed$/, ''));
    if (existsSync(target)) continue;
    try {
      const plain = gunzipSync(openSealed(readFileSync(abs), privateKey));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, plain, { flag: 'wx' });
      opened++;
    } catch (error) {
      failed++;
      console.error(`${abs}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
};
walk(inDir);
console.error(`Opened ${opened} file${opened === 1 ? '' : 's'}${failed ? `, ${failed} would not open` : ''}.`);
process.exit(failed ? 1 : 0);
