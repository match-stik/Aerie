// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// On Windows, a path built with path.join or resolve is C:\..., and Node's
// ES module loader refuses it outright (ERR_UNSUPPORTED_ESM_URL_SCHEME) before
// a single line of the imported file runs. On Linux the same path is a valid
// specifier, so nothing here ever notices. Found from a Windows house: reading
// a key and opening a sealed backup both failed at the first line. The fix is
// import(pathToFileURL(p).href).
//
// So every dynamic import in the scripts people run by hand, and in the
// backend and phone sources, must be given a string literal, or a URL made
// with pathToFileURL or new URL. Anything else is assumed to be a raw path.

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DIRS = ['tools', 'scripts', 'desktop', 'workers', 'runtimes', 'packages/backend/src', 'packages/phone/src'];
const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'release']);
const EXT = /\.(mjs|cjs|js|ts|tsx)$/;

// Files whose dynamic import is handed a URL by its caller rather than a path.
const ALLOWED: Record<string, string> = {
  // workers.test.ts passes pathToFileURL(...).href as argv[2].
  'workers/spotify-mcp/test.mjs': 'its argument is already a file URL',
};

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(name) && !name.endsWith('.d.ts') && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

export function rawPathImports(source: string): number[] {
  const lines: number[] = [];
  source.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    for (const m of code.matchAll(/\bimport\(\s*([^\s)])/g)) {
      const rest = code.slice((m.index ?? 0) + m[0].length - 1);
      if (/^['"`]/.test(rest)) continue;
      if (/^(pathToFileURL\(|new URL\()/.test(rest)) continue;
      lines.push(i + 1);
    }
  });
  return lines;
}

test('rawPathImports flags a raw path and passes literals and URLs', () => {
  assert.deepEqual(rawPathImports("const m = await import(lib);"), [1]);
  assert.deepEqual(rawPathImports("await import(resolve(root, 'x.js'));"), [1]);
  assert.deepEqual(rawPathImports("await import('node:fs');\nawait import(pathToFileURL(lib).href);\nawait import(new URL('./a.js', import.meta.url).href);"), []);
  assert.deepEqual(rawPathImports("type T = import('./x.js').Y;"), []);
});

test('no dynamic import is handed a raw file path, which Windows refuses', () => {
  const offenders: string[] = [];
  for (const dir of DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file).split('\\').join('/');
      if (ALLOWED[rel]) continue;
      for (const n of rawPathImports(readFileSync(file, 'utf8'))) offenders.push(`${rel}:${n}`);
    }
  }
  assert.deepEqual(offenders, [], 'wrap the path: import(pathToFileURL(p).href)');
});
