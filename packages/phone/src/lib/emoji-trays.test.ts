// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The trays carry Unicode's whole list, once each, in keyboard sections, and
// the owner's five quick reactions fall back slot by slot (the owner's ask, Oct 26 2026).

import test from 'node:test';
import assert from 'node:assert/strict';
import { EMOJI_SECTIONS, STANDARD_EMOJIS, EMOJI_DATA_VERSION } from './emoji.js';
import { quickReactionsOf, DEFAULT_QUICK_REACTIONS } from './quick-reactions.js';

test('the tray list is the whole generated set, each emoji once', () => {
  assert.equal(EMOJI_DATA_VERSION, '18.0');
  assert.equal(STANDARD_EMOJIS.length, 1923);
  assert.equal(new Set(STANDARD_EMOJIS).size, STANDARD_EMOJIS.length, 'no emoji appears twice');
  assert.deepEqual(EMOJI_SECTIONS.map((s) => s.label), [
    'Smileys & Emotion', 'People & Body', 'Animals & Nature', 'Food & Drink',
    'Activities', 'Travel & Places', 'Objects', 'Symbols', 'Flags',
  ]);
});

test('the ones the old hand-typed list was missing are in it', () => {
  for (const e of ['🪿', '🩶', '❤️‍🔥', '🐦‍⬛', '🐦‍🔥', '😶‍🌫️', '🥹', '💋', '🧑‍💻']) {
    assert.ok(STANDARD_EMOJIS.includes(e), `${e} is in the tray`);
  }
  // No skin-tone variants; those would quadruple the People tab.
  assert.ok(!STANDARD_EMOJIS.some((e) => /[\u{1F3FB}-\u{1F3FF}]/u.test(e)));
});

test("the owner's five keep the owner's picks and fill only the empty slots", () => {
  assert.deepEqual(quickReactionsOf(undefined), DEFAULT_QUICK_REACTIONS);
  assert.deepEqual(quickReactionsOf(['🪿', '', null, ':flint:']), ['🪿', '👍', '🔥', ':flint:', '😮']);
  assert.deepEqual(quickReactionsOf('not a list'), DEFAULT_QUICK_REACTIONS);
});
