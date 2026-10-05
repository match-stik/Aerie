// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import test from 'node:test';
import assert from 'node:assert';
import { classifyCortexConfigError } from './cortex.js';

// A probe that cannot read its own config used to report "no worker URL set" —
// the same sentence it gives for a house that genuinely has no brain. That is
// unknown dressed as a definite no, and it would drop Cortex silently out of
// the readout rather than saying it could not be checked.

test('a genuinely unconfigured brain is named as such', () => {
  const p = classifyCortexConfigError('Cortex not configured. Set the Cortex worker URL in Memory → Cortex.');
  assert.equal(p.configured, false);
  assert.equal(p.detail, 'no worker URL set');
});

test('a config read that threw is UNKNOWN, not unconfigured', () => {
  // The real one: getSecret throws this when the database is not open.
  const p = classifyCortexConfigError('Database not initialized. Call initDb() first.');
  assert.equal(p.configured, true, 'must not claim the owner has no brain');
  assert.equal(p.ok, false);
  assert.match(p.detail, /could not read config/);
});

test('the detail stays short enough for a toast', () => {
  const p = classifyCortexConfigError('x'.repeat(500));
  assert.ok(p.detail.length < 100, p.detail.length + ' chars');
});
