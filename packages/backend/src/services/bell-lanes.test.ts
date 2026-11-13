// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ringsOnceInSharedLane, sharedRingWakeCompanion, laneSwitchBefore, laneSwitchAfter, LANES_HOLD_MS } from './bell-lanes.js';

const now = new Date('2026-09-24T22:00:00Z');
const inMinutes = (m: number) => new Date(now.getTime() + m * 60_000);

test('a bell only turns the switch on when their person asked for it and it is off', () => {
  assert.equal(laneSwitchBefore({ splitLanes: true, multiLane: false }), 'turn_on');
  assert.equal(laneSwitchBefore({ splitLanes: true, multiLane: true }), 'leave');
  assert.equal(laneSwitchBefore({ splitLanes: false, multiLane: false }), 'leave');
});

test('a switch their person turned on by hand is never turned off by a bell', () => {
  assert.equal(laneSwitchAfter({ turnedOnByBell: false, multiLane: true, nextSplitBellAt: null, now }), 'leave');
});

test('the switch stays on while another split bell is coming', () => {
  assert.equal(laneSwitchAfter({ turnedOnByBell: true, multiLane: true, nextSplitBellAt: inMinutes(30), now }), 'leave');
});

test('after the last bell of the night the switch goes back off', () => {
  assert.equal(laneSwitchAfter({ turnedOnByBell: true, multiLane: true, nextSplitBellAt: null, now }), 'turn_off');
  const tomorrow = new Date(now.getTime() + LANES_HOLD_MS + 60_000);
  assert.equal(laneSwitchAfter({ turnedOnByBell: true, multiLane: true, nextSplitBellAt: tomorrow, now }), 'turn_off');
});

test('if their person already turned it off by hand, there is nothing to do', () => {
  assert.equal(laneSwitchAfter({ turnedOnByBell: true, multiLane: false, nextSplitBellAt: null, now }), 'leave');
});

test('with one shared head a several-owner bell rings once, not once per owner', () => {
  assert.equal(ringsOnceInSharedLane({ multiLane: false, owners: 3 }), true);
});

test('with a lane each, the owners still take turns', () => {
  assert.equal(ringsOnceInSharedLane({ multiLane: true, owners: 3 }), false);
});

test('a bell with one owner is never changed by this', () => {
  assert.equal(ringsOnceInSharedLane({ multiLane: false, owners: 1 }), false);
});

// A bell that rings once for all its owners has to ring in the shared room.
// Handing the shared ring the first owner's id sent it to that companion's own
// warm room instead, with only his memory in front of him, and he answered for
// every owner from there.
test('a bell that rings once for everybody rings in the shared room, never the first owner\'s', async () => {
  assert.equal(sharedRingWakeCompanion(), undefined);
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('./orchestrator.ts', import.meta.url)), 'utf8');
  const start = src.indexOf('share one head tonight, ringing once');
  assert.ok(start > 0, 'the shared ring is still where this test looks for it');
  const call = src.slice(start, src.indexOf('\n', src.indexOf('processAutonomous(', start)));
  assert.doesNotMatch(call, /owners\[0\]/);
  assert.match(call, /sharedRingWakeCompanion\(\)/);
});
