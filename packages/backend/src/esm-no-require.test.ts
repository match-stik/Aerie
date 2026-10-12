// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The backend is "type": "module", so require() does not exist at runtime. A
// call to it compiles clean and throws the first time it runs, and when the
// call sits inside a try with a bare catch, nothing ever says so. Two of them
// lived for months: the GIF Lab's temp-folder cleanup never removed a folder,
// and /internal/sticker-send answered "Failed to send sticker" to every call.
//
// provision.ts is the one honest exception: it writes CommonJS hook files out
// as text, so its require() calls sit inside template strings and run in a
// .cjs file, where they belong.

const SRC = fileURLToPath(new URL('.', import.meta.url));
const ALLOWED = new Set(['services/heartbeat/provision.ts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

test('no backend source calls require(), because an ES module has no require', () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split('\\').join('/');
    if (ALLOWED.has(rel)) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').trim();
      if (code.startsWith('*') || code.startsWith('/*')) return;
      if (/(^|[^.\w$])require\(/.test(code) && !code.includes('createRequire')) {
        offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [], 'require() is undefined at runtime in this package');
});
