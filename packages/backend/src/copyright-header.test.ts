// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Every source file opens with the copyright line (Sep 26 2026). A new file
// that arrives without it fails here, so nobody has to remember to add it.
// Since Oct 14 2026 the line also asks anyone porting code to keep it and
// credit Aerie in their NOTICE file, since a comment is what travels with
// ported code. Both halves are checked here.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE = /\.(ts|tsx|js|mjs|cjs|java|css|py)$/;
// workers/spotify-mcp is built on Kay's base code (its README credits it) and
// carries no header line of ours.
const SKIP = /^(node_modules|data|logs|workers\/spotify-mcp)\/|\/(dist|build)\//;
const HEADER = /Copyright \d{4} Aerie Systems\. Licensed under the Apache License 2\.0\./;
const CANARY = /Porting code from here\? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before\./;

test('every tracked source file opens with the copyright line', (t) => {
  let listed: string;
  try {
    listed = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch {
    t.skip('not a git checkout, so there is no list of tracked files to read');
    return;
  }
  const files = listed.split('\n').filter((f) => SOURCE.test(f) && !SKIP.test(f));
  // A nearly empty list would pass without looking at anything.
  assert.ok(files.length > 100, `only ${files.length} source files were listed`);
  const missing = files.filter((f) => {
    // Line one, or under a shebang, or under a Python coding line.
    const opening = readFileSync(join(ROOT, f), 'utf8').split('\n').slice(0, 3);
    return !opening.some((line) => HEADER.test(line) && CANARY.test(line));
  });
  assert.deepStrictEqual(missing.slice(0, 10), [], `${missing.length} source files have no copyright line with its porting note`);
});

test('NOTICE tells a port what it owes, in words it can copy', () => {
  const notice = readFileSync(join(ROOT, 'NOTICE'), 'utf8');
  assert.match(notice, /Porting from Aerie/);
  assert.match(notice, /Includes code from Aerie \(https:\/\/github\.com\/match-stik\/Aerie\),/);
});
