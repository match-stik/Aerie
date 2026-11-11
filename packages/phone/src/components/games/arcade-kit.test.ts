// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert';
import { contrastRatio, readableInk } from './arcade-kit.js';

test('a pop-up ink that already reads is left exactly as the palette made it', () => {
  assert.strictEqual(readableInk('#ffffff', '#101018'), '#ffffff');
  assert.strictEqual(readableInk('#1a1a2e', '#f4efe9'), '#1a1a2e');
});

test('a pop-up ink that drowns is leaned until it reads at 4.5 to 1, whatever is behind it', () => {
  // The cases they saw: a pale glow on a pale sea, a pink on a pale day page,
  // a blue on dark water of the same hue.
  for (const [want, behind] of [['#c9ccd3', '#d8cfe0'], ['#e9a0a8', '#efe6e4'], ['#5b6b8c', '#1d2433'], ['#88c0d0', '#7a8fa8']]) {
    const ink = readableInk(want, behind);
    assert.ok(contrastRatio(ink, behind) >= 4.5, `${want} on ${behind} came back ${ink}`);
  }
});

test('the contrast ratio is the WCAG one', () => {
  assert.strictEqual(Math.round(contrastRatio('#ffffff', '#000000')), 21);
  assert.strictEqual(contrastRatio('#777777', '#777777'), 1);
});
