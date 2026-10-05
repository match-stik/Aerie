// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// EVERY HOUSE IN THE WORLD WAS TOLD TO CALL CODEX BY NAME.
//
// Rose and Sol, Sep 17 2026: a house without the Codex CLI gets a spontaneous
// wake instructing it to use a backend it does not have, and a red banner for
// a thing it never chose. The picture was never at risk — Studio walks its
// fallback chain — so the entire cost was a false alarm about somebody else's
// setup.
//
// The owner's call: make it universal, and do not quietly move ours. Both hold,
// because an unset `image_gen.backend` resolves to codex, which is exactly what
// this house was already being told.

import test from 'node:test';
import assert from 'node:assert/strict';
import { imageBackendClause } from './orchestrator.js';

test('a codex house is told exactly what it was told before', () => {
  assert.equal(imageBackendClause('codex'), 'backend:"codex", codexModel:"gpt-5.6-terra", ');
});

test('another backend is named, and the codex-only key does not ride along', () => {
  assert.equal(imageBackendClause('antigravity'), 'backend:"antigravity", ');
  assert.doesNotMatch(imageBackendClause('openart'), /codexModel/);
});

test('no configured backend names none, and lets the server decide', () => {
  assert.equal(imageBackendClause(''), '');
  assert.equal(imageBackendClause('   '), '');
});
