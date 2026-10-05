// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heartbeatTimezone } from './runtime.js';

test('heartbeat orientation uses the configured identity timezone', () => {
  assert.equal(
    heartbeatTimezone({ identity: { timezone: 'Pacific/Auckland' } }),
    'Pacific/Auckland',
  );
});

test('heartbeat orientation falls back to UTC when identity has no timezone', () => {
  assert.equal(heartbeatTimezone({ identity: { timezone: '' } }), 'UTC');
  assert.equal(heartbeatTimezone({}), 'UTC');
});
