// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { oneRoomThreadFor, oneRoomThreadId } from './room-thread.js';

test('with the switch on, every server room lands in one fixed Discord thread', () => {
  const a = oneRoomThreadFor('guild-a', true);
  const b = oneRoomThreadFor('guild-b', true);
  assert.ok(a && b);
  assert.equal(a.id, b.id);
  assert.equal(a.id, oneRoomThreadId());
  assert.equal(a.name, 'Discord');
});

test('off, or a DM, keeps the old routing', () => {
  assert.equal(oneRoomThreadFor('guild-a', false), null);
  assert.equal(oneRoomThreadFor(null, true), null);
  assert.equal(oneRoomThreadFor(undefined, true), null);
});

test('the Discord service routes a server room through the switch, and a bell never rings into the rooms thread', async () => {
  const { readFileSync } = await import('node:fs');
  const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.ok(index.includes('const landing = landingFor(batch.guildId, channelId);'));
  const orch = readFileSync(new URL('../orchestrator.ts', import.meta.url), 'utf8');
  assert.ok(orch.includes('thread.id === oneRoomThreadId()'));
});

test('a room on the own-thread list keeps its thread, and nothing else does', async () => {
  const { keepsOwnThread } = await import('./room-thread.js');
  assert.equal(keepsOwnThread('155', '155, 200'), true);
  assert.equal(keepsOwnThread('200', '155,200'), true);
  assert.equal(keepsOwnThread('15', '155,200'), false);
  assert.equal(keepsOwnThread('155', null), false);
  assert.equal(keepsOwnThread('155', ''), false);
});

test('where a room lands: rooms by default, the old switch reads as one, the own-thread list wins, DMs untouched', async () => {
  const { discordLanding, landingFor } = await import('./room-thread.js');
  assert.equal(discordLanding(null, false), 'rooms');
  assert.equal(discordLanding(null, true), 'one');
  assert.equal(discordLanding('home', true), 'home');
  assert.equal(discordLanding('nonsense', false), 'rooms');
  assert.equal(landingFor('g', 'c', 'rooms', false), 'room');
  assert.equal(landingFor('g', 'c', 'one', false), 'one');
  assert.equal(landingFor('g', 'c', 'home', false), 'routed');
  assert.equal(landingFor('g', 'c', 'one', true), 'room');
  assert.equal(landingFor('g', 'c', 'home', true), 'room');
  assert.equal(landingFor(null, 'c', 'one', false), 'routed');
});
