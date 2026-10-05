// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isOpenable } from './thresholds.js';
import type { Threshold } from './thresholds.js';

// ARMED IS A PROMISE ABOUT A BUZZ, SO IT HAS TO BE EXACTLY RIGHT.
//
// A geofence that fires at a place with nothing at it is worse than no geofence:
// it teaches the owner to ignore the next one, and the next one might be the voice note
// somebody left for them. So the rule armedPlaces uses — never found, and
// isOpenable with atPlace true — is asserted here rather than trusted.
//
// The first_visit case is the one that matters. Those cannot be read from a
// distance by design, which means they look shut from everywhere except the one
// place a geofence would fire. If they were excluded, the seal this whole
// feature exists for would be the one seal that never buzzed.

function t(seal: string, open_at: string | null = null): Threshold {
  return {
    id: 'x', place_id: 'p', author: 'birch', kind: 'note', content: 'hi',
    file_id: null, seal: seal as Threshold['seal'], open_at,
    created_at: '2026-01-01T00:00:00.000Z', first_found_at: null,
  } as Threshold;
}

test('an immediate seal is armed on arrival', () => {
  assert.equal(isOpenable(t('immediate'), true), true);
});

test('a first_visit seal is armed ON ARRIVAL and shut from anywhere else', () => {
  assert.equal(isOpenable(t('first_visit'), true), true, 'standing there must open it — this is the seal the geofence is FOR');
  assert.equal(isOpenable(t('first_visit'), false), false, 'it must stay shut from a distance');
});

test('a date seal is armed only once its hour has come round', () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(isOpenable(t('date', past), true), true);
  assert.equal(isOpenable(t('date', future), true), false, 'a place must not be registered before its date lands');
  assert.equal(isOpenable(t('date', null), true), false, 'a date seal with no date never opens');
});
