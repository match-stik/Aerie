// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { ServerMessage } from '@aerie/shared';
import {
  commandFromLane,
  describeToyCommand,
  recordPhoneState,
  recordToyAck,
  relayToyCommand,
  resetToyRemoteForTests,
  toyRemoteStatus,
} from './toy-remote.js';

const NOW = new Date('2026-10-12T12:30:00Z');

beforeEach(() => resetToyRemoteForTests());

test('a plain level holds for the default and then ends', () => {
  const shaped = commandFromLane({ companion: 'Birch', level: 12 }, NOW, 'c1');
  assert.ok(shaped.ok);
  assert.deepEqual(shaped.command, {
    id: 'c1',
    companion: 'birch',
    at: NOW.toISOString(),
    action: 'play',
    tracks: { main: [[12, 30_000]] },
    loops: 1,
    maxMs: 30_000,
  });
});

test('levels are clamped to the toy range, and a long ask is cut to the ceiling', () => {
  const shaped = commandFromLane({ companion: 'willow', level: 25, motor: 'fingering', seconds: 900 }, NOW, 'c2');
  assert.ok(shaped.ok);
  assert.deepEqual(shaped.command.tracks, { fingering: [[20, 180_000]] });
  assert.equal(shaped.command.maxMs, 180_000);
});

test('tracks keep their steps, stretch a too-short step, and loops multiply the end', () => {
  const shaped = commandFromLane(
    { companion: 'cedar', tracks: { FLEXER_VIBRATE: [[4, 1000], [8, 50]], FLEXER_FINGER: [[0, 2000]] }, loops: 3 },
    NOW,
    'c3',
  );
  assert.ok(shaped.ok);
  assert.deepEqual(shaped.command.tracks, { FLEXER_VIBRATE: [[4, 1000], [8, 200]], FLEXER_FINGER: [[0, 2000]] });
  assert.equal(shaped.command.loops, 3);
  assert.equal(shaped.command.maxMs, 6000);
});

test('loops can never carry a command past the ceiling', () => {
  const shaped = commandFromLane({ companion: 'birch', tracks: { main: [[10, 60_000]] }, loops: 50 }, NOW, 'c4');
  assert.ok(shaped.ok);
  assert.equal(shaped.command.maxMs, 180_000);
});

test('a preset is one of four and runs for its seconds', () => {
  const ok = commandFromLane({ companion: 'birch', preset: 2, seconds: 45 }, NOW, 'c5');
  assert.ok(ok.ok);
  assert.equal(ok.command.preset, 2);
  assert.equal(ok.command.presetMs, 45_000);
  assert.equal(commandFromLane({ companion: 'birch', preset: 7 }, NOW).ok, false);
});

test('stop needs nothing else', () => {
  const shaped = commandFromLane({ companion: 'willow', stop: true }, NOW, 'c6');
  assert.ok(shaped.ok);
  assert.equal(shaped.command.action, 'stop');
  assert.equal(describeToyCommand(shaped.command), 'stop');
});

test('an ask with no companion, or with nothing to do, is refused with a reason', () => {
  for (const body of [null, {}, { level: 5 }, { companion: 'birch' }, { companion: 'birch', tracks: {} }, { companion: 'birch', tracks: { main: [[5]] } }]) {
    const shaped = commandFromLane(body, NOW);
    assert.equal(shaped.ok, false, JSON.stringify(body));
    if (!shaped.ok) assert.ok(shaped.error.length > 0);
  }
});

test('with no phone connected the lane is told so at once, and nothing is sent', async () => {
  const shaped = commandFromLane({ companion: 'birch', level: 8 }, NOW, 'c7');
  assert.ok(shaped.ok);
  const sent: ServerMessage[] = [];
  const ack = await relayToyCommand(shaped.command, { broadcast: (m) => sent.push(m), connected: () => false, waitMs: 50 });
  assert.equal(ack.ok, false);
  assert.equal(ack.reason, 'no-phone');
  assert.equal(sent.length, 0);
});

test('the phone answer is what the lane gets back', async () => {
  const shaped = commandFromLane({ companion: 'birch', level: 8 }, NOW, 'c8');
  assert.ok(shaped.ok);
  const sent: ServerMessage[] = [];
  const waiting = relayToyCommand(shaped.command, { broadcast: (m) => sent.push(m), connected: () => true, waitMs: 1000 });
  assert.deepEqual(sent, [{ type: 'toy_command', command: shaped.command }]);
  assert.equal(recordToyAck({ id: 'someone-else', ok: true }), false);
  assert.equal(recordToyAck({ id: 'c8', ok: false, reason: 'closed', detail: 'The owner has not handed you the remote.' }), true);
  const ack = await waiting;
  assert.equal(ack.reason, 'closed');
  assert.equal(toyRemoteStatus(() => true).last?.ack?.reason, 'closed');
});

test('a phone that never answers comes back as no-answer, not as taken', async () => {
  const shaped = commandFromLane({ companion: 'cedar', level: 8 }, NOW, 'c9');
  assert.ok(shaped.ok);
  const ack = await relayToyCommand(shaped.command, { broadcast: () => {}, connected: () => true, waitMs: 20 });
  assert.equal(ack.ok, false);
  assert.equal(ack.reason, 'no-answer');
  // A late answer finds nobody waiting, and one that says nothing is playing sends nothing.
  const sent: ServerMessage[] = [];
  assert.equal(recordToyAck({ id: 'c9', ok: true, playing: null }, { broadcast: (m) => sent.push(m) }), false);
  assert.equal(sent.length, 0);
});

test('a late answer that started something is stopped at once', () => {
  const sent: ServerMessage[] = [];
  const playing = { companion: 'willow', commandId: 'c10', startedAt: NOW.toISOString(), endsAt: NOW.toISOString(), motors: [] };
  assert.equal(recordToyAck({ id: 'c10', ok: true, playing }, { broadcast: (m) => sent.push(m) }), false);
  assert.equal(sent.length, 1);
  const message = sent[0];
  assert.ok(message.type === 'toy_command');
  if (message.type === 'toy_command') {
    assert.equal(message.command.action, 'stop');
    assert.equal(message.command.companion, 'willow');
  }
});

test('the phone state is kept as sent and only when it looks like one', () => {
  assert.equal(recordPhoneState({ gate: 'sideways', toys: [] }), false);
  assert.equal(toyRemoteStatus(() => true).state, null);
  assert.equal(recordPhoneState({ at: NOW.toISOString(), bridge: true, gate: 'open', away: false, hands: false, toys: [], playing: null }), true);
  assert.equal(toyRemoteStatus(() => true).state?.gate, 'open');
});

// ---- the light door ----

test('a light ask is its own command: no motor, no length, and the ask kept as the lane gave it', () => {
  const on = commandFromLane({ companion: 'Willow', light: 'ON' }, NOW, 'l1');
  assert.ok(on.ok);
  assert.deepEqual(on.command, { id: 'l1', companion: 'willow', at: NOW.toISOString(), action: 'light', light: { action: 'on' }, maxMs: 0 });
  assert.equal(describeToyCommand(on.command), 'light on');

  const named = commandFromLane({ companion: 'birch', light: 'off', toy: ' Domi 2 ', which: 'alight' }, NOW, 'l2');
  assert.ok(named.ok);
  assert.deepEqual(named.command.light, { action: 'off', toy: 'Domi 2', which: 'alight' });
  assert.equal(describeToyCommand(named.command), 'light off (alight) on Domi 2');

  const byId = commandFromLane({ companion: 'cedar', light: 'flash', toyId: 'abc' }, NOW, 'l3');
  assert.ok(byId.ok);
  assert.equal(byId.command.toyId, 'abc');
  assert.equal(byId.command.tracks, undefined, 'a light carries no tracks for the phone to play');
  assert.equal(byId.command.preset, undefined);
});

test('a light ask that does not make sense is refused with a reason, and never mixed with motion', () => {
  for (const body of [
    { companion: 'birch', light: 'blink' },
    { companion: 'birch', light: true },
    { companion: 'birch', light: 'on', level: 10 },
    { companion: 'birch', light: 'on', tracks: { main: [[4, 1000]] } },
    { companion: 'birch', light: 'on', preset: 2 },
    { companion: 'birch', light: 'on', which: 'disco' },
    { companion: 'birch', light: 'flash', which: 'light' },
    { companion: 'birch', light: 'on', toy: '   ' },
    { companion: 'birch', light: 'on', toy: 7 },
  ]) {
    const shaped = commandFromLane(body, NOW);
    assert.equal(shaped.ok, false, JSON.stringify(body));
    if (!shaped.ok) assert.ok(shaped.error.length > 0);
  }
});

test('a stop beside a light is still a stop', () => {
  const shaped = commandFromLane({ companion: 'willow', stop: true, light: 'on' }, NOW, 'l4');
  assert.ok(shaped.ok);
  assert.equal(shaped.command.action, 'stop');
});

test('the phone answer to a light is what the lane gets back, toy by toy', async () => {
  const shaped = commandFromLane({ companion: 'cedar', light: 'on' }, NOW, 'l5');
  assert.ok(shaped.ok);
  const sent: ServerMessage[] = [];
  const waiting = relayToyCommand(shaped.command, { broadcast: (m) => sent.push(m), connected: () => true, waitMs: 1000 });
  assert.deepEqual(sent, [{ type: 'toy_command', command: shaped.command }]);
  const light = { action: 'on' as const, took: [{ toyId: 'd2', name: 'Domi 2', command: 'ALIGHT_ON' }], refused: [] };
  assert.equal(recordToyAck({ id: 'l5', ok: true, light, detail: 'Light on: Domi 2 took ALIGHT_ON.' }), true);
  const ack = await waiting;
  assert.equal(ack.ok, true);
  assert.deepEqual(ack.light, light);
});

test('a light the phone never answered is no-answer, never assumed taken', async () => {
  const shaped = commandFromLane({ companion: 'birch', light: 'flash' }, NOW, 'l6');
  assert.ok(shaped.ok);
  const ack = await relayToyCommand(shaped.command, { broadcast: () => {}, connected: () => true, waitMs: 20 });
  assert.equal(ack.ok, false);
  assert.equal(ack.reason, 'no-answer');
  const none = await relayToyCommand(shaped.command, { broadcast: () => {}, connected: () => false, waitMs: 20 });
  assert.equal(none.reason, 'no-phone');
});

test('a late light answer never sends a stop, even with something playing beside it', () => {
  const sent: ServerMessage[] = [];
  const playing = { companion: 'willow', commandId: 'p1', startedAt: NOW.toISOString(), endsAt: NOW.toISOString(), motors: [] };
  const light = { action: 'on' as const, took: [{ toyId: 'd2', name: 'Domi 2', command: 'ALIGHT_ON' }], refused: [] };
  assert.equal(recordToyAck({ id: 'l7', ok: true, light, playing }, { broadcast: (m) => sent.push(m) }), false);
  assert.equal(sent.length, 0, 'the play beside the light was started by a command the lane knows about');
});

test('the how a lane reads names the light door and where each toy keeps its lights', () => {
  const how = toyRemoteStatus(() => true).how;
  assert.match(how, /light: "on" \| "off" \| "flash"/);
  assert.match(how, /never touches the motors/);
  assert.match(how, /state\.toys\[\]\.lights/);
});

test('the how a lane reads says what a battery level is, and that no level is not an empty toy', () => {
  const how = toyRemoteStatus(() => true).how;
  assert.match(how, /batteryAt/);
  assert.match(how, /batteryWorking/);
  assert.match(how, /not the same as empty/);
});

test('the phone\'s battery answer reaches the lane as the phone sent it, and an unread toy has none', () => {
  const at = '2026-10-21T13:33:00.000Z';
  assert.equal(recordPhoneState({
    at, bridge: true, gate: 'open', away: false, hands: false, playing: null,
    toys: [
      { toyId: 'fz', name: 'Fizz', battery: 59, batteryAt: at, motors: [], presets: 4 },
      { toyId: 'x1', name: 'Flexer', motors: [], presets: 4 },
    ],
  }), true);
  const toys = toyRemoteStatus(() => true).state?.toys ?? [];
  assert.equal(toys[0].battery, 59);
  assert.equal(toys[0].batteryAt, at);
  assert.equal('battery' in toys[1], false);
});
