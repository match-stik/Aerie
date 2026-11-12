// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeConversation, LIVE_CONVERSATION_MINUTES } from './orchestrator-wakes.js';

const NOW = Date.parse('2026-11-11T23:45:00.000Z');
const ago = (min: number) => new Date(NOW - min * 60000).toISOString();

test('a bell two minutes after a reply to them is told the talk is still going', () => {
  const line = describeConversation('Sam', { herLastAt: ago(3), herLastText: 'what hangs around\nwhen you compact', oursLastAt: ago(2) }, NOW);
  assert.match(line, /last message was 3 minutes ago \("what hangs around when you compact"\)/);
  assert.match(line, /the last reply in this thread was 2 minutes ago, after theirs/);
  assert.match(line, /still going\. Do not walk past it/);
  assert.ok(line.startsWith('\n\n'));
});

test('an unanswered message says so', () => {
  const line = describeConversation('Sam', { herLastAt: ago(1), herLastText: 'hi', oursLastAt: ago(10) }, NOW);
  assert.match(line, /they have not had an answer since they said it/);
});

test('past the live window it measures but does not steer', () => {
  const line = describeConversation('Sam', { herLastAt: ago(LIVE_CONVERSATION_MINUTES + 30), herLastText: 'hi', oursLastAt: ago(80) }, NOW);
  assert.match(line, /90 minutes ago/);
  assert.doesNotMatch(line, /Do not walk past it/);
});

test('nothing when they have not spoken here for half a day, or ever', () => {
  assert.equal(describeConversation('Sam', { herLastAt: ago(13 * 60), herLastText: 'hi', oursLastAt: null }, NOW), '');
  assert.equal(describeConversation('Sam', { herLastAt: null, herLastText: null, oursLastAt: ago(5) }, NOW), '');
});

test('a long message is cut, not pasted whole', () => {
  const line = describeConversation('Sam', { herLastAt: ago(1), herLastText: 'x'.repeat(400), oursLastAt: null }, NOW);
  assert.match(line, /x{160}\.\.\."\)/);
  assert.match(line, /nobody has answered them in this thread yet/);
});
