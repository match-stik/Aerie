// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { isPageHidden, shouldHoldLineBetweenTurns } from './mic-hold';

test('a call on screen hands its line back after every turn, so the car leaves call mode', () => {
  assert.equal(shouldHoldLineBetweenTurns({ retaining: true, isRetainedLine: true, pageHidden: false }), false);
});

test('a call carried out of the app keeps its line, the case the August fix was for', () => {
  assert.equal(shouldHoldLineBetweenTurns({ retaining: true, isRetainedLine: true, pageHidden: true }), true);
});

test('nothing is held outside a call or for a line that is not the kept one', () => {
  assert.equal(shouldHoldLineBetweenTurns({ retaining: false, isRetainedLine: true, pageHidden: true }), false);
  assert.equal(shouldHoldLineBetweenTurns({ retaining: true, isRetainedLine: false, pageHidden: true }), false);
});

test('the page reads hidden only when the document says so', () => {
  assert.equal(isPageHidden({ visibilityState: 'hidden' }), true);
  assert.equal(isPageHidden({ visibilityState: 'visible' }), false);
  assert.equal(isPageHidden(undefined), false);
});
