// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { externalOpenRoute } from './open-external.js';

// The plugin has a native half, so an APK built before it exists reports the
// plugin as unavailable. That case has to keep working exactly as it does
// today rather than throwing: a link that behaves as it always has beats a
// link that does nothing at all.
test('the browser sheet is only used where it actually exists', () => {
  assert.equal(externalOpenRoute(true, true), 'browser-sheet');
  assert.equal(externalOpenRoute(true, false), 'new-tab');
});

test('the browser reads as a normal new tab', () => {
  assert.equal(externalOpenRoute(false, false), 'new-tab');
  assert.equal(externalOpenRoute(false, true), 'new-tab');
});
