// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Blocked (Nov 24 2026): a person or bot their person never wants answered.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ruleBlocks } from './rules.js';

test('only a blocked rule blocks', () => {
  assert.equal(ruleBlocks({ trustLevel: 'blocked' }), true);
  for (const t of ['standard', 'limited', 'full'] as const) assert.equal(ruleBlocks({ trustLevel: t }), false, t);
  assert.equal(ruleBlocks(undefined), false, 'no rule is not a block; it is limited');
});

test('both doors check it: people in preflight, bots at the gateway', () => {
  const preflight = readFileSync(new URL('./preflight.ts', import.meta.url), 'utf8');
  const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(preflight, /if \(ruleBlocks\(userRule\)\) \{\n\s+return \{ allowed: false/);
  assert.match(index, /if \(ruleBlocks\(botRule\)\) return;/);
});
