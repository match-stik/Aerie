// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A lane's light ask on their phone: which toy gets which light command, and
// that the answer is what the sender said, toy by toy, with no motor touched.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAskedToy, lightCommandFor, lightsFor, planLight, runLight, type LightSend, type LightToy } from './toy-light';

// Command lists as the SDK README's matrix gives them for the owner's toys: the Domi 2
// lists both pairs, the Ferri and the Flexer the plain light and FLASH.
const DOMI2: LightToy = {
  toyId: 'd2', name: 'Lovense Domi 2',
  commands: ['VIBRATE', 'VIBRATE_FLASH', 'FLASH', 'LIGHT_OFF', 'LIGHT_ON', 'GET_LIGHT_STATUS', 'ALIGHT_OFF', 'ALIGHT_ON', 'GET_ALIGHT_STATUS', 'GET_BATTERY', 'PRESET'],
};
const FERRI: LightToy = { toyId: 'f1', name: 'Ferri', commands: ['VIBRATE', 'FLASH', 'LIGHT_OFF', 'LIGHT_ON', 'GET_LIGHT_STATUS', 'GET_BATTERY', 'PRESET'] };
const FLEXER: LightToy = { toyId: 'x1', name: 'Flexer', commands: ['VIBRATE', 'VIBRATE1', 'VIBRATE2', 'FLASH', 'LIGHT_OFF', 'LIGHT_ON', 'FLEXER_VIBRATE', 'FLEXER_FINGER'] };
// A toy that has not said what it can do yet.
const QUIET: LightToy = { toyId: 'q1', name: 'Fizz', commands: ['VIBRATE'] };

const MOTION = new Set(['VIBRATE', 'VIBRATE1', 'VIBRATE2', 'VIBRATE3', 'ROTATE', 'THRUST', 'FLEXER_VIBRATE', 'FLEXER_FINGER', 'OSCILLATE', 'PRESET', 'AIR_AUTO']);

function recorder(answer: (toyId: string, command: string) => 'ok' | 'held' | 'failed' = () => 'ok') {
  const calls: [string, string][] = [];
  const send: LightSend = async (toyId, command) => {
    calls.push([toyId, command]);
    return answer(toyId, command);
  };
  return { calls, send };
}

test('a toy lists its light commands in one order, and a toy with none lists nothing', () => {
  assert.deepEqual(lightsFor(DOMI2), ['FLASH', 'LIGHT_ON', 'LIGHT_OFF', 'ALIGHT_ON', 'ALIGHT_OFF']);
  assert.deepEqual(lightsFor(FERRI), ['FLASH', 'LIGHT_ON', 'LIGHT_OFF']);
  assert.deepEqual(lightsFor(QUIET), []);
});

test('on and off use the Domi\'s own pair when it lists one, the plain pair otherwise, and the ask can name the pair', () => {
  assert.deepEqual(lightCommandFor(DOMI2, 'on'), { command: 'ALIGHT_ON' });
  assert.deepEqual(lightCommandFor(DOMI2, 'off'), { command: 'ALIGHT_OFF' });
  assert.deepEqual(lightCommandFor(DOMI2, 'on', 'light'), { command: 'LIGHT_ON' });
  assert.deepEqual(lightCommandFor(FERRI, 'on'), { command: 'LIGHT_ON' });
  assert.deepEqual(lightCommandFor(FERRI, 'off', 'alight'), { why: 'it lists no ALIGHT_OFF' });
  assert.deepEqual(lightCommandFor(FERRI, 'flash'), { command: 'FLASH' });
  assert.ok('why' in lightCommandFor(QUIET, 'on'));
  assert.ok('why' in lightCommandFor(QUIET, 'flash'));
});

test('a toy is asked for by its id or its name, with or without Lovense in front', () => {
  assert.equal(isAskedToy('d2', DOMI2), true);
  assert.equal(isAskedToy('domi 2', DOMI2), true);
  assert.equal(isAskedToy('Lovense Domi 2', DOMI2), true);
  assert.equal(isAskedToy('Domi', DOMI2), false);
  assert.equal(isAskedToy('', DOMI2), false);
});

test('with no toy named the ask reaches every connected toy, each with its own command', () => {
  const plan = planLight({ light: { action: 'on' } }, [DOMI2, FERRI, QUIET]);
  assert.deepEqual(plan.sends.map((s) => `${s.toyId}:${s.command}`), ['d2:ALIGHT_ON', 'f1:LIGHT_ON']);
  assert.deepEqual(plan.refused.map((r) => r.toyId), ['q1']);
  assert.deepEqual(planLight({ light: { action: 'on', toy: 'ferri' } }, [DOMI2, FERRI]).sends.map((s) => s.toyId), ['f1']);
  assert.deepEqual(planLight({ toyId: 'd2', light: { action: 'flash' } }, [DOMI2, FERRI]).sends.map((s) => s.toyId), ['d2']);
  assert.equal(planLight({ light: { action: 'on', toy: 'Gemini' } }, [DOMI2, FERRI]).targets.length, 0);
});

test('the answer is what each toy took, it carries no playing, and nothing but a light command is ever sent', async () => {
  const { calls, send } = recorder();
  const ack = await runLight({ id: 'c1', light: { action: 'on' } }, [DOMI2, FLEXER, QUIET], send);
  assert.equal(ack.ok, true);
  assert.equal(ack.id, 'c1');
  assert.equal('playing' in ack, false, 'a light answer never says what is playing, so the house can never stop it as a late play');
  assert.deepEqual(ack.light?.took.map((t) => t.command), ['ALIGHT_ON', 'LIGHT_ON']);
  assert.deepEqual(ack.light?.refused.map((r) => r.name), ['Fizz']);
  assert.match(ack.detail ?? '', /motors were not touched/);
  assert.equal(calls.some(([, command]) => MOTION.has(command)), false);
  assert.deepEqual(calls, [['d2', 'ALIGHT_ON'], ['x1', 'LIGHT_ON']]);
});

test("the owner's stop holding refuses the light the way it refuses motion", async () => {
  const { send } = recorder(() => 'held');
  const ack = await runLight({ id: 'c2', light: { action: 'flash' } }, [FERRI], send);
  assert.equal(ack.ok, false);
  assert.equal(ack.reason, 'held');
  assert.deepEqual(ack.light?.took, []);
});

test('a toy that did not take it is said so, and an ask no toy can do sends nothing', async () => {
  const { send } = recorder((toyId) => (toyId === 'f1' ? 'failed' : 'ok'));
  const some = await runLight({ id: 'c3', light: { action: 'off' } }, [DOMI2, FERRI], send);
  assert.equal(some.ok, true);
  assert.deepEqual(some.light?.refused, [{ toyId: 'f1', name: 'Ferri', why: 'the toy did not take LIGHT_OFF' }]);

  const none = recorder((toyId) => (toyId === 'f1' ? 'failed' : 'ok'));
  const failed = await runLight({ id: 'c4', light: { action: 'on' } }, [FERRI], none.send);
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'bad');

  const idle = recorder();
  const nothing = await runLight({ id: 'c5', light: { action: 'on', which: 'alight' } }, [FERRI, QUIET], idle.send);
  assert.equal(nothing.ok, false);
  assert.equal(nothing.reason, 'no-toy');
  assert.match(nothing.detail ?? '', /Ferri \(FLASH, LIGHT_ON, LIGHT_OFF\)/);
  assert.deepEqual(idle.calls, []);
});

test('a toy named that is not connected is no-toy, and so is an empty phone', async () => {
  const { calls, send } = recorder();
  const missing = await runLight({ id: 'c6', light: { action: 'on', toy: 'Gemini' } }, [FERRI], send);
  assert.equal(missing.reason, 'no-toy');
  assert.match(missing.detail ?? '', /No connected toy is Gemini/);
  const empty = await runLight({ id: 'c7', light: { action: 'on' } }, [], send);
  assert.equal(empty.reason, 'no-toy');
  assert.equal(empty.detail, 'No toy is connected on their phone.');
  assert.deepEqual(calls, []);
});
