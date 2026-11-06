// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { socketSessionEnded } from './ws.js';

const now = new Date('2026-11-06T12:00:00Z');
const live = { expires_at: '2026-11-10T00:00:00Z' };

test('a socket whose session was logged out or has expired is closed on the next heartbeat', () => {
  assert.equal(socketSessionEnded('tok', true, () => live, now), false);
  assert.equal(socketSessionEnded('tok', true, () => undefined, now), true);
  assert.equal(socketSessionEnded('tok', true, () => ({ expires_at: '2026-11-01T00:00:00Z' }), now), true);
  assert.equal(socketSessionEnded(undefined, true, () => live, now), true);
  // A house with no password never had sessions to end.
  assert.equal(socketSessionEnded(undefined, false, () => undefined, now), false);
});
