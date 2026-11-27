// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenArtAccount } from './image-credits.js';

// Both shapes are copied from the real answers on Nov 26 2026.
test('OpenArt credits and plan are read from the account tool reply', () => {
  const got = parseOpenArtAccount('{"user":{"uid":"x","email":"x@example.com"},"plan":"Pro","credits":23362}');
  assert.deepEqual(got, { balance: 23362, unit: 'credits', plan: 'Pro' });
});

test('OpenArt JSON inside prose is still found', () => {
  const got = parseOpenArtAccount('Here is the account:\n{"plan":"Pro","credits":12}\nUse it wisely.');
  assert.equal(got?.balance, 12);
});

test('an OpenArt reply with no credits field reads as nothing, not zero', () => {
  assert.equal(parseOpenArtAccount('{"plan":"Pro"}'), null);
  assert.equal(parseOpenArtAccount('not json at all'), null);
});
