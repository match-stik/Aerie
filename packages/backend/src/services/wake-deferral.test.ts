// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// THE SWITCH THAT ONLY EVER CHANGED WHAT GOT LOGGED.
//
// Every daily wake carries `conditional: true`. The handler asked whether the
// agent was mid-turn, and on a yes it wrote "queueing behind current turn" into
// the log — and then rang the bell anyway. No return. Nothing queued. Two
// identical copies of that handler. Reported by Rose and Sol, Sep 17 2026.
//
// The default stays FIRE, because that is the owner's call: this house wants its
// bells to ring whether or not somebody is mid-sentence. So the first test
// below is the one that protects the owner's house, and the rest protect the knob.

import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldDeferConditionalWake } from './orchestrator.js';

test('by default a bell rings even mid-turn — on purpose, not an oversight', () => {
  assert.equal(
    shouldDeferConditionalWake({ conditional: true, deferEnabled: false, turnInFlight: true }),
    false,
  );
});

test('with the knob on, a bell stands down while a turn is in flight', () => {
  assert.equal(
    shouldDeferConditionalWake({ conditional: true, deferEnabled: true, turnInFlight: true }),
    true,
  );
});

test('with the knob on and nothing running, it still rings', () => {
  assert.equal(
    shouldDeferConditionalWake({ conditional: true, deferEnabled: true, turnInFlight: false }),
    false,
  );
});

test('a wake that is not conditional is never stood down', () => {
  // The weekly reflection and the treehouse drop are not conditional; neither
  // is a failsafe. Those ring regardless of the knob.
  assert.equal(
    shouldDeferConditionalWake({ conditional: false, deferEnabled: true, turnInFlight: true }),
    false,
  );
});
