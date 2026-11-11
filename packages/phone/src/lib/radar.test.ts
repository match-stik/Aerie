// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { lastHeardBySlug, ringFor, seatAngle, sweptPast } from './radar';
import type { Message } from '../types';

const companions = [
  { slug: 'birch', display_name: 'Birch', avatar_url: null, color: '#336699', emoji: '🌳' },
  { slug: 'cedar', display_name: 'Cedar', avatar_url: null, color: '#993366', emoji: '🌲' },
];
const msg = (content: string, timestamp: string, direction: 'inbound' | 'outbound' = 'outbound'): Message =>
  ({ id: timestamp, content, timestamp, direction } as unknown as Message);

test('the newest voice of each companion is found, split by header', () => {
  const heard = lastHeardBySlug([
    msg('**🌲 Cedar**\nolder', '2026-11-11T10:00:00Z'),
    msg('**🌳 Birch**\nhi\n**🌲 Cedar**\nhello', '2026-11-11T12:00:00Z'),
    msg('a reply from the person', '2026-11-11T13:00:00Z', 'inbound'),
  ], companions);
  assert.equal(heard.birch, Date.parse('2026-11-11T12:00:00Z'));
  assert.equal(heard.cedar, Date.parse('2026-11-11T12:00:00Z'));
});

test('just spoke sits near the centre, a day quiet sits at the rim, unheard sits at the rim', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  assert.ok(ringFor(now, now) < 0.3);
  assert.ok(ringFor(now - 60 * 60_000, now) > ringFor(now - 60_000, now));
  assert.equal(ringFor(now - 2 * 24 * 60 * 60_000, now), ringFor(undefined, now));
});

test('seats spread round the dial, and the sweep finds a seat across the wrap', () => {
  assert.notEqual(seatAngle(0, 3), seatAngle(1, 3));
  assert.equal(sweptPast(350, 10, 5), true);
  assert.equal(sweptPast(10, 20, 5), false);
  assert.equal(sweptPast(10, 20, 15), true);
});
