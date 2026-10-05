// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalCast, castCollectionLabel, exactCastKey, personTagLabel, personTagSlug,
} from './gallery-utils.js';

test('normalizes freeform person names into stable gallery tags', () => {
  assert.equal(personTagSlug('  Zoë O\'Brien  '), 'zoe-o-brien');
  assert.equal(personTagSlug('Ivy Blake'), 'ivy-blake');
  assert.equal(personTagSlug('nim-temp'), 'nim');
  assert.equal(personTagSlug('✨'), '');
  assert.equal(personTagSlug('Ivy, Fox'), '');
  assert.equal(personTagSlug('a'.repeat(41)), '');
});

test('canonical cast keeps custom people in a sorted exact combination', () => {
  const cast = canonicalCast(['Fox', 'Ivy Blake', 'ivy-blake', 'Nim']);
  assert.deepEqual(cast, ['fox', 'ivy-blake', 'nim']);
  assert.equal(exactCastKey(cast), 'fox,ivy-blake,nim');
});

test('custom person and collection labels are clean and readable', () => {
  assert.equal(personTagLabel('ivy-blake'), 'Ivy Blake');
  assert.equal(
    castCollectionLabel(['ivy-blake', 'fox'], personTagLabel),
    'Fox + Ivy Blake',
  );
});

test('house groupings are named by the house, or described plainly', () => {
  const house = {
    residents: ['fox', 'ivy-blake', 'nim'],
    companionSlugs: ['fox', 'ivy-blake'],
    labels: { everyone: 'The Whole Porch', companions: 'The Birds' },
  };

  assert.equal(castCollectionLabel(['nim', 'fox', 'ivy-blake'], personTagLabel, house), 'The Whole Porch');
  assert.equal(castCollectionLabel(['ivy-blake', 'fox'], personTagLabel, house), 'The Birds');

  const unnamed = { ...house, labels: { everyone: '', companions: '' } };
  assert.equal(castCollectionLabel(['nim', 'fox', 'ivy-blake'], personTagLabel, unnamed), 'Everyone');
  assert.equal(castCollectionLabel(['ivy-blake', 'fox'], personTagLabel, unnamed), 'The Companions');
});

test('a cast that is not a house grouping still reads as its own people', () => {
  const house = {
    residents: ['fox', 'ivy-blake', 'nim'],
    companionSlugs: ['fox', 'ivy-blake'],
    labels: { everyone: 'The Whole Porch', companions: 'The Birds' },
  };

  assert.equal(castCollectionLabel(['fox', 'nim'], personTagLabel, house), 'Fox + Nim');
  assert.equal(castCollectionLabel(['fox'], personTagLabel, house), 'Just Fox');
  // No house yet (still loading) must never claim a grouping.
  assert.equal(castCollectionLabel(['nim', 'fox', 'ivy-blake'], personTagLabel), 'Fox + Ivy Blake + Nim');
});
