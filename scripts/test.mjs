#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
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

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawn } from 'node:child_process';
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

const child = spawn(
  process.execPath,
  ['--import', 'tsx', '--test', ...selected],
  { cwd: root, stdio: 'inherit' },
);
child.on('exit', code => process.exit(code ?? 1));
