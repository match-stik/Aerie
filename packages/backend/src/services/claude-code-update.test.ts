// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, VERSION_RE } from './claude-code-update.js';

test('versions compare as numbers, not text', () => {
  assert.equal(compareVersions('2.1.98', '2.1.111'), -1);
  assert.equal(compareVersions('2.1.322', '2.1.322'), 0);
  assert.equal(compareVersions('3.0.0', '2.9.999'), 1);
});

test('only a plain version number passes the door', () => {
  assert.ok(VERSION_RE.test('2.1.322'));
  for (const bad of ['latest', '2.1', '2.1.3; rm -rf /', '2.1.3\n--x', '../2.1.3', '-g', '']) {
    assert.equal(VERSION_RE.test(bad), false, bad);
  }
});
