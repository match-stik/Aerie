// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atLeast, parseCliVersion } from './cli-version.js';

test('the version line parses, and an unreadable one is never new enough', () => {
  assert.deepEqual(parseCliVersion('2.1.280 (Claude Code)'), [2, 1, 280]);
  assert.equal(parseCliVersion('nope'), null);
  assert.equal(atLeast(null, [2, 1, 295]), false);
});

test('comparison is numeric, not by text', () => {
  assert.equal(atLeast([2, 1, 280], [2, 1, 295]), false);
  assert.equal(atLeast([2, 1, 295], [2, 1, 295]), true);
  assert.equal(atLeast([2, 1, 300], [2, 1, 299]), true);
  assert.equal(atLeast([2, 2, 0], [2, 1, 299]), true);
  assert.equal(atLeast([2, 1, 1000], [2, 2, 0]), false);
});

test('the newer settings stay off on this box today and turn on at their versions', async () => {
  const { newerCliSettings } = await import('./provision.js');
  assert.deepEqual(newerCliSettings([2, 1, 280]), { gateBlocks: false, idleCompactionOff: false });
  assert.deepEqual(newerCliSettings([2, 1, 295]), { gateBlocks: true, idleCompactionOff: false });
  assert.deepEqual(newerCliSettings([2, 1, 299]), { gateBlocks: true, idleCompactionOff: true });
  assert.deepEqual(newerCliSettings(null), { gateBlocks: false, idleCompactionOff: false });
});
