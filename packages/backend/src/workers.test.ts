// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The workers' own tests live beside them (workers/*/test.mjs), outside the
// packages npm test walks, and so went stale unseen: the Spotify one failed 14
// of 15 for a week after its worker changed. This runs them with everything else.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('the Spotify worker passes its own tests', (t) => {
  const dir = join(ROOT, 'workers', 'spotify-mcp');
  if (!existsSync(join(dir, 'test.mjs'))) { t.skip('no Spotify worker in this tree'); return; }
  let out = '';
  try {
    out = execFileSync(process.execPath, [join(dir, 'test.mjs'), join(dir, 'index.js')], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    out = String((err as { stdout?: string }).stdout ?? err);
  }
  assert.doesNotMatch(out, /^FAIL/m, out);
  assert.match(out, /^ok /m, out);
});
