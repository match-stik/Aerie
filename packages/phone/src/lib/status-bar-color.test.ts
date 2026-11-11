// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { opaqueHex } from './status-bar-color.js';

test('a six-digit hex goes through as it is', () => {
  assert.equal(opaqueHex('#0D0A08'), '#0d0a08');
  assert.equal(opaqueHex('  #FAF6F3 '), '#faf6f3');
});

test('an eight-digit CSS hex loses its alpha, which comes LAST in CSS', () => {
  // Android would read #RRGGBBAA as #AARRGGBB and paint the wrong color.
  assert.equal(opaqueHex('#12345680'), '#123456');
});

test('a three-digit hex is spelled out', () => {
  assert.equal(opaqueHex('#fa0'), '#ffaa00');
});

test('without a page to read it, anything else is unreadable rather than guessed', () => {
  assert.equal(opaqueHex('rgb(1, 2, 3)'), null);
  assert.equal(opaqueHex('not a color'), null);
});
