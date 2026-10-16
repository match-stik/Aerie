// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The phone's decisions on a lane's command, with a stand-in bridge: a light
// goes through the same gate as motion, and leaves what is playing alone.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { ToyRemoteCommand } from '@aerie/shared';
import type { LovenseToy } from './lovense-toys';
import { handOver, setHands, takeBack, toyRemoteSnapshot, toyRemoteTestSeam } from './toy-remote';

const FLEXER: LovenseToy = {
  toyId: 'x1', name: 'Flexer', connected: true,
  commands: ['VIBRATE', 'VIBRATE1', 'VIBRATE2', 'FLASH', 'LIGHT_OFF', 'LIGHT_ON', 'FLEXER_VIBRATE', 'FLEXER_FINGER', 'PRESET'],
};
const DOMI2: LovenseToy = {
  toyId: 'd2', name: 'Domi 2', connected: true,
  commands: ['VIBRATE', 'FLASH', 'LIGHT_OFF', 'LIGHT_ON', 'ALIGHT_OFF', 'ALIGHT_ON', 'PRESET'],
};

function standIn(answer: (command: string) => 'ok' | 'held' = () => 'ok') {
  const sent: { toyId: string; command: string; level?: number }[] = [];
  toyRemoteTestSeam.useBridge({
    toys: async () => ({ toys: [FLEXER, DOMI2] }),
    command: async (options) => {
      sent.push(options);
      if (answer(options.command) === 'held') throw Object.assign(new Error('The owner stop is holding'), { code: 'HELD' });
    },
  });
  return sent;
}

const at = () => new Date().toISOString();
const play = (id: string): ToyRemoteCommand => ({ id, companion: 'birch', at: at(), action: 'play', tracks: { all: [[8, 5000]] }, loops: 1, maxMs: 5000 });
const light = (id: string, action: 'on' | 'off' | 'flash'): ToyRemoteCommand => ({ id, companion: 'willow', at: at(), action: 'light', light: { action }, maxMs: 0 });
const stop = (id: string): ToyRemoteCommand => ({ id, companion: 'birch', at: at(), action: 'stop', maxMs: 0 });

afterEach(async () => {
  // Nothing left running between tests: the stop clears every timer.
  await toyRemoteTestSeam.decide(stop('cleanup'));
  setHands(false);
  takeBack();
});

test('a light leaves what is playing exactly as it was, and sends nothing to a motor', async () => {
  const sent = standIn();
  handOver();
  const started = await toyRemoteTestSeam.decide(play('p1'));
  assert.equal(started.ok, true);
  const before = toyRemoteSnapshot().playing;
  assert.equal(before?.commandId, 'p1');
  assert.ok((before?.motors.length ?? 0) > 0);
  sent.length = 0;

  const ack = await toyRemoteTestSeam.decide(light('l1', 'on'));
  assert.equal(ack.ok, true);
  assert.deepEqual(ack.light?.took.map((t) => `${t.toyId}:${t.command}`), ['x1:LIGHT_ON', 'd2:ALIGHT_ON']);
  assert.equal('playing' in ack, false);
  assert.deepEqual(toyRemoteSnapshot().playing, before, 'the play is the same command, the same motors, the same levels');
  assert.deepEqual(sent, [{ toyId: 'x1', command: 'LIGHT_ON' }, { toyId: 'd2', command: 'ALIGHT_ON' }], 'no zero and no level went to a motor');
});

test('a light is refused when the remote is not handed over, the same way motion is', async () => {
  const sent = standIn();
  takeBack();
  const motion = await toyRemoteTestSeam.decide(play('p2'));
  const lit = await toyRemoteTestSeam.decide(light('l2', 'flash'));
  assert.equal(motion.reason, 'closed');
  assert.equal(lit.reason, 'closed');
  assert.equal(lit.detail, motion.detail);
  assert.deepEqual(sent, []);
});

test('a light is refused while the owner has the orbs open', async () => {
  const sent = standIn();
  handOver();
  setHands(true);
  const lit = await toyRemoteTestSeam.decide(light('l3', 'on'));
  assert.equal(lit.ok, false);
  assert.equal(lit.reason, 'hands');
  assert.deepEqual(sent, []);
});

test("a light while the owner's stop holds is refused as held", async () => {
  standIn(() => 'held');
  handOver();
  const lit = await toyRemoteTestSeam.decide(light('l4', 'off'));
  assert.equal(lit.ok, false);
  assert.equal(lit.reason, 'held');
});

// ---- the battery the house is told ----

test('the house hears a toy\'s own battery answer, and nothing before it, whatever the SDK field says', async () => {
  // The SDK field as it stood on Oct 21 2026: the Fizz at 29 after charging
  // (the owner's Lovense app said about 59), the Flexer at 0 while it ran.
  const FIZZ: LovenseToy = { toyId: 'fz', name: 'Fizz', connected: true, battery: 29, commands: ['VIBRATE'] };
  const RUNNING: LovenseToy = { ...FLEXER, battery: 0 };
  toyRemoteTestSeam.useBridge({ toys: async () => ({ toys: [FIZZ, RUNNING] }), command: async () => {} });

  const before = await toyRemoteTestSeam.phoneToys();
  assert.deepEqual(before.map((t) => 'battery' in t), [false, false], 'never read: no level at all, never 29 and never 0');

  assert.equal(toyRemoteTestSeam.recordBattery({ toyId: 'fz', level: 59, working: false }), true);
  assert.equal(toyRemoteTestSeam.recordBattery({ toyId: 'x1', level: 80, working: true }), true);
  assert.equal(toyRemoteTestSeam.recordBattery({ toyId: 'x1', level: -1, working: true }), false);
  const after = await toyRemoteTestSeam.phoneToys();
  const fizz = after.find((t) => t.toyId === 'fz');
  const flexer = after.find((t) => t.toyId === 'x1');
  assert.equal(fizz?.battery, 59);
  assert.ok(fizz?.batteryAt && Date.parse(fizz.batteryAt) > 0);
  assert.equal(fizz?.batteryWorking, undefined);
  assert.equal(flexer?.battery, 80);
  assert.equal(flexer?.batteryWorking, true, 'read while running is said so');
});

test('handing the remote over asks every connected toy for its battery, every minute, until the owner takes it back', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const sent = standIn();
  const asks = () => sent.filter((s) => s.command === 'GET_BATTERY').map((s) => s.toyId);
  const flush = () => new Promise((r) => setImmediate(r));
  toyRemoteTestSeam.pretendBridge(true);
  try {
    takeBack();
    await flush();
    sent.length = 0;
    handOver();
    await flush();
    assert.deepEqual(asks(), ['x1', 'd2'], 'asked the moment the owner hands it over');
    t.mock.timers.tick(60_000);
    await flush();
    assert.deepEqual(asks(), ['x1', 'd2', 'x1', 'd2'], 'and again a minute later');
    takeBack();
    t.mock.timers.tick(120_000);
    await flush();
    assert.equal(asks().length, 4, 'nothing asked once the owner has taken it back');
  } finally {
    takeBack();
    toyRemoteTestSeam.pretendBridge(false);
  }
});

test('taking the remote back stops every toy, not only the motors we drove', async () => {
  const sent = standIn();
  let stops = 0;
  const real = toyRemoteTestSeam.useStopAll(async () => { stops++; });
  try {
    handOver();
    const started = await toyRemoteTestSeam.decide(play('t1'));
    assert.equal(started.ok, true);
    sent.length = 0;
    takeBack();
    assert.equal(toyRemoteSnapshot().gate, 'closed');
    assert.equal(toyRemoteSnapshot().closedBy, 'owner');
    assert.equal(toyRemoteSnapshot().playing, null);
    assert.equal(stops, 1, 'the native stop went to every toy');
    assert.ok(sent.every((s) => s.level === 0), 'what we drove went to zero');
  } finally {
    toyRemoteTestSeam.useStopAll(real);
  }
});

test('taking the remote back leaves their own fingers on the orbs alone', async () => {
  standIn();
  let stops = 0;
  const real = toyRemoteTestSeam.useStopAll(async () => { stops++; });
  try {
    handOver();
    setHands(true);
    takeBack();
    assert.equal(toyRemoteSnapshot().gate, 'closed');
    assert.equal(stops, 0);
  } finally {
    setHands(false);
    toyRemoteTestSeam.useStopAll(real);
  }
});
