// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatStatusNudge } from './our-status.js';

const now = Date.parse('2026-11-24T03:00:00Z');
const crew = [{ slug: 'juniper', name: 'Juniper' }, { slug: 'rowan', name: 'Rowan' }];
const set = (minsAgo: number, text = 'In the kitchen') => ({ text, icon: null, by: 'x', setAt: new Date(now - minsAgo * 60_000).toISOString(), until: null });

test('nothing is said while every status in the room is fresh', () => {
  assert.equal(formatStatusNudge(crew, { juniper: set(20), rowan: set(100) }, now, 180), '');
});

test('a faded status and a stale one are both named, with the door to change them', () => {
  const line = formatStatusNudge(crew, { rowan: set(240, 'Reading') }, now, 180);
  assert.match(line, /Juniper's has faded back to Home/);
  assert.match(line, /Rowan's still says "Reading" from 4 hours ago/);
  assert.match(line, /api\/internal\/status/);
});
