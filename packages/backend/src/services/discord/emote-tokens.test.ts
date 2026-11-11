// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A Discord message's custom emotes are put back after cleanContent strips
// them to :name:. Oct 21 2026: a title with the same emote on each side was
// stored as '<<:name:id>id> ... :name:', the second token nested inside the
// first, and the phone drew a stray < and a long number around the picture.

import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreEmoteTokens } from './debouncer.js';

const CAULDRON = '<:cauldron:100000000000000001>';

test('the same emote twice comes back as two whole tokens, one in each place', () => {
  const raw = `# ${CAULDRON} THE MENU ${CAULDRON}`;
  const cleaned = '# :cauldron: THE MENU :cauldron:';
  assert.equal(restoreEmoteTokens(raw, cleaned), raw);
});

test('different emotes keep their order', () => {
  const a = '<:fire:123456789012345678>';
  const b = '<a:smoke:223456789012345678>';
  assert.equal(restoreEmoteTokens(`${a} and ${b} and ${a}`, ':fire: and :smoke: and :fire:'), `${a} and ${b} and ${a}`);
});

test('a message with no emotes is the cleaned text untouched', () => {
  assert.equal(restoreEmoteTokens('hi <@123>', 'hi @someone'), 'hi @someone');
});

test('a token whose :name: the cleaned text no longer has is skipped, not forced in', () => {
  assert.equal(restoreEmoteTokens(`${CAULDRON} x`, 'x'), 'x');
});
