// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Every source file opens with the copyright line (Sep 26 2026). A new file
// that arrives without it fails here, so nobody has to remember to add it.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE = /\.(ts|tsx|js|mjs|cjs|java|css|py)$/;
const SKIP = /^(node_modules|data|logs)\/|\/(dist|build)\//;
const HEADER = /Copyright \d{4} Aerie Systems\. Licensed under the Apache License 2\.0\./;

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
    return !opening.some((line) => HEADER.test(line));
  });
  assert.deepStrictEqual(missing.slice(0, 10), [], `${missing.length} source files have no copyright line`);
});
