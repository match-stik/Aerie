// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Ringing them: who is calling reads plainly, and a bad ask is refused with the reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { callerTitle, readRingAsk, ringData, RING_KIND, noteRing, takeRing, pickGreeting, GREETING_WINDOW_MS } from './ring-call.js';

test('the call screen names who is calling', () => {
  const names = { birch: 'Birch', willow: 'Willow', cedar: 'Cedar' };
  assert.equal(callerTitle(['birch', 'willow', 'cedar'], names), 'Birch, Willow and Cedar');
  assert.equal(callerTitle(['cedar'], names), 'Cedar');
  assert.equal(callerTitle(['birch', 'willow']), 'Birch and Willow');
  assert.equal(callerTitle([]), 'Your companions');
});

test('an ask names who is ringing; callers default to everyone', () => {
  const everyone = ['birch', 'willow', 'cedar'];
  assert.deepEqual(readRingAsk({ companion: 'Willow' }, everyone), { ok: true, companion: 'willow', callers: everyone });
  assert.deepEqual(readRingAsk({ companion: 'Willow' }), { ok: true, companion: 'willow', callers: ['willow'] });
  assert.deepEqual(readRingAsk({ companion: 'cedar', callers: ['cedar'] }, everyone), { ok: true, companion: 'cedar', callers: ['cedar'] });
  assert.equal(readRingAsk({}).ok, false);
  assert.equal(readRingAsk({ companion: 'birch', callers: 'all' }).ok, false);
  assert.equal(readRingAsk({ companion: 'birch', callers: [] }).ok, false);
});

test('the push carries its kind, the title and the callers', () => {
  assert.deepEqual(ringData(['birch', 'cedar'], { cedar: 'Cedar' }), { kind: RING_KIND, title: 'Birch and Cedar', callers: 'birch,cedar' });
});

test('a ring is taken once, and only inside its window', () => {
  assert.equal(takeRing(1_000), false);
  noteRing(1_000);
  assert.equal(takeRing(1_000 + GREETING_WINDOW_MS), true);
  assert.equal(takeRing(1_000 + GREETING_WINDOW_MS), false);
  noteRing(1_000);
  assert.equal(takeRing(1_001 + GREETING_WINDOW_MS), false);
});

test('the greeting is our newest reply, never one older than their newest message', () => {
  const ours = { id: 'c2', role: 'companion', sequence: 12, content: 'Hi, darling.', content_type: 'text' };
  const theirs = { id: 'u1', role: 'user', sequence: 11, content: 'Try again?', content_type: 'text' };
  assert.deepEqual(pickGreeting([ours, theirs]), { messageId: 'c2', sequence: 12 });
  assert.equal(pickGreeting([theirs, ours]), null);
  const blank = { id: 'c3', role: 'companion', sequence: 13, content: '[No response]', content_type: 'text' };
  const picture = { id: 'c4', role: 'companion', sequence: 14, content: 'x', content_type: 'image' };
  assert.deepEqual(pickGreeting([picture, blank, ours, theirs]), { messageId: 'c2', sequence: 12 });
  assert.equal(pickGreeting([]), null);
});
