#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Fetches the three browser builds the Artifacts viewer and the Story Shelf
// widgets run in (lib/sealed-frame.ts) into data/vendor/, pinned by version and
// checked by SHA-256 before anything is written. React 19 no longer ships
// these single-file builds, so they are React 18's. All three are MIT
// (THIRD_PARTY_LICENSES.md).
//
//   npm run vendor
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'data', 'vendor');

const FILES = [
  {
    name: 'react.production.min.js',
    url: 'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
    sha256: 'd949f1c3687aedadcedac85261865f29b17cd273997e7f6b2bfc53b2f9d4c4dd',
  },
  {
    name: 'react-dom.production.min.js',
    url: 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
    sha256: '35f4f974f4b2bcd44da73963347f8952e341f83909e4498227d4e26b98f66f0d',
  },
  {
    name: 'babel.min.js',
    url: 'https://unpkg.com/@babel/standalone@7.24.7/babel.min.js',
    sha256: 'd9e33722fdfba37e4e428aa72cb58da65f18358bfb229e136dfc1285e76b03ff',
  },
];

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

mkdirSync(DIR, { recursive: true });
let failed = false;
for (const file of FILES) {
  const target = join(DIR, file.name);
  if (existsSync(target) && sha(readFileSync(target)) === file.sha256) {
    console.log(`ok       ${file.name} (already here)`);
    continue;
  }
  try {
    const res = await fetch(file.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = sha(buf);
    if (got !== file.sha256) throw new Error(`checksum ${got} is not the pinned ${file.sha256}`);
    writeFileSync(target, buf);
    console.log(`fetched  ${file.name}`);
  } catch (err) {
    failed = true;
    console.error(`FAILED   ${file.name}: ${err instanceof Error ? err.message : err}`);
  }
}
if (failed) {
  console.error('\nThe Artifacts viewer and Story Shelf widgets need all three. Nothing half-downloaded was kept.');
  process.exit(1);
}
console.log(`\nAll three are in ${DIR}.`);
