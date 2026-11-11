// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_HEADER_REM, CARD_MAX_WIDTH_REM, CARD_SIDE_GAP_REM, contactCardAspect, faceGuideStyle } from './contact-card-frame.js';

test('on a phone the card is the screen less its gaps, over a header 14 rem tall', () => {
  // 387 css px wide at a 16 px root: 387 - 32 = 355 wide, 224 tall.
  assert.equal(+contactCardAspect(387, 16).toFixed(4), +(355 / 224).toFixed(4));
});

test('on a wide screen the card stops at its own width', () => {
  assert.equal(contactCardAspect(1200, 16), (CARD_MAX_WIDTH_REM * 16) / (CARD_HEADER_REM * 16));
});

test('the font size setting moves the card the way the card itself moves', () => {
  const rem = 14.4;
  const width = Math.min(CARD_MAX_WIDTH_REM * rem, 387 - 2 * CARD_SIDE_GAP_REM * rem);
  assert.equal(contactCardAspect(387, rem), width / (CARD_HEADER_REM * rem));
});

test('a reading it cannot make falls back to the widest card, never to nothing', () => {
  assert.equal(contactCardAspect(Number.NaN, 16), CARD_MAX_WIDTH_REM / CARD_HEADER_REM);
  assert.equal(contactCardAspect(387, 0), CARD_MAX_WIDTH_REM / CARD_HEADER_REM);
});

test('the face guide is a circle touching the top and bottom of the card, clear inside and dimmed outside', () => {
  const style = faceGuideStyle();
  assert.match(String(style.backgroundImage), /^radial-gradient\(circle closest-side/);
  assert.match(String(style.backgroundImage), /transparent calc\(100% - 2px\)/);
});
