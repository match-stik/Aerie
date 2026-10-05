// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// THREE PLACES THIS HOUSE WAS COMPILED INTO A KIT OTHER PEOPLE INSTALL.
//
// Rose and Sol, Sep 17 2026: OWNER_SEAT was hard-coded to this house's owner
// at the card table, and this house's own pet names for the owner sat inside the
// classifier that decides what a voice reads aloud. Their owner's name is in
// neither, so their table seats somebody who does not live there and a line
// addressed to their owner is skipped as scenery.
//
// Both now resolve from the house's own identity. The seat needs no test beyond
// this note — getOwnerSlug() is already covered — but the address list has a
// fallback chain worth pinning, because getting it wrong is silent: a name that
// falls out of the list does not error, it just stops being spoken.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDirectAddressPattern } from './tts-text.js';

test('with nothing configured, a house recognises its own person', () => {
  const re = buildDirectAddressPattern([], 'Rose');
  assert.ok(re.test('come here, Rose'));
  assert.ok(!re.test('come here, starling'), 'and inherits nobody else’s');
});

test('a configured list is the house-specific half, on top of the generic one', () => {
  const re = buildDirectAddressPattern(['starling', 'little moth'], 'Owner');
  assert.ok(re.test('one thing, starling'));
  assert.ok(re.test('my little moth'));
  assert.ok(re.test('one thing, darling'), 'the universal endearments always stand');
});

test('a name with regex in it is a name, not a pattern', () => {
  const re = buildDirectAddressPattern(['b.b', 'a+b'], 'X');
  assert.ok(re.test('hello b.b'));
  assert.ok(!re.test('hello bob'), 'the dot is a dot');
});

test('an empty configuration does not match everything', () => {
  // A trailing comma or a blank key must not produce an alternation with an
  // empty branch, which would match every line and read every stage direction
  // aloud — the exact failure this classifier exists to prevent.
  const re = buildDirectAddressPattern(['', '  '], '');
  assert.ok(!re.test('settles'));
  assert.ok(re.test('darling'));
});
