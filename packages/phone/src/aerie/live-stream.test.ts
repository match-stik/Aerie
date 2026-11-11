// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { liveStreamIdFor } from './live-stream';

// A reopened app missed the stream_start of a turn already running; its tool
// events still need somewhere to land so the working phrases show.

test('an open reply keeps its own id', () => {
  assert.equal(liveStreamIdFor('abc', 'active', 5), 'abc');
});

test('no reply open while a turn runs: a local one opens', () => {
  assert.equal(liveStreamIdFor(null, 'active', 5), 'live-5');
});

test('no reply open and no turn running: nothing opens', () => {
  assert.equal(liveStreamIdFor(null, 'dormant', 5), null);
  assert.equal(liveStreamIdFor(null, undefined, 5), null);
});
