// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { bodyStack, fontsOf, titleStack } from './fonts';

test('a phone today, the serif switch and no size, starts as Noto Serif everywhere at 1', () => {
  assert.deepEqual(fontsOf({ fontFamily: 'font-serif' }), { title: 'noto', body: 'noto', scale: 1, titleScale: 1 });
});

test('the old switch and sizes start the new settings where they were', () => {
  assert.equal(fontsOf({ fontFamily: 'font-mono' }).body, 'mono');
  assert.equal(fontsOf({}).body, 'geist');
  assert.equal(fontsOf({}, 'font-serif').body, 'noto');
  assert.equal(fontsOf({ fontSize: 'small' }).scale, 0.9);
  assert.equal(fontsOf({ fontSize: 'large' }).scale, 1.125);
});

test('a choice the owner made wins, and the size stays on the slider', () => {
  assert.deepEqual(fontsOf({ fontTitle: 'playfair', fontBody: 'geist', fontScale: 1.1, fontFamily: 'font-serif' }), { title: 'playfair', body: 'geist', scale: 1.1, titleScale: 1 });
  assert.equal(fontsOf({ fontScale: 3 }).scale, 1.2);
  assert.equal(fontsOf({ fontScale: 0.2 }).scale, 0.9);
  assert.equal(fontsOf({ fontTitle: 'comic', fontBody: 'papyrus' }).title, 'noto');
});

test('every stack names its face first and falls back to a serif or the system', () => {
  assert.match(titleStack('cormorant'), /^"Cormorant Garamond"/);
  assert.match(bodyStack('mono'), /^"JetBrains Mono"/);
});

test('titles carry their own size, clamped, and start where they were', () => {
  assert.equal(fontsOf({}).titleScale, 1);
  assert.equal(fontsOf({ fontTitleScale: 1.25 }).titleScale, 1.25);
  assert.equal(fontsOf({ fontTitleScale: 9 }).titleScale, 1.4);
  assert.equal(fontsOf({ fontTitleScale: 0.1 }).titleScale, 0.8);
});

test('the new faces are choosable and name themselves first', () => {
  assert.equal(fontsOf({ fontTitle: 'specialelite', fontBody: 'atkinson' }).title, 'specialelite');
  assert.equal(fontsOf({ fontBody: 'atkinson' }).body, 'atkinson');
  assert.match(titleStack('cinzel'), /^"Cinzel"/);
  assert.match(bodyStack('lora'), /^"Lora"/);
});
