// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStageDirection } from './tts-text.js';

// The delivery-only pattern used to let a run of commas and spaces be matched
// in exponentially many ways, so one odd italic line could hold the whole house
// (measured Oct 1 2026: 33 seconds on a 31-character line). It has to answer at
// once now, whatever the line is.
test('a run of separators after a delivery word answers at once', () => {
  const line = 'low' + ' ,'.repeat(12) + 'x';
  const start = Date.now();
  isStageDirection(line);
  assert.ok(Date.now() - start < 1000, `took ${Date.now() - start}ms`);
});
