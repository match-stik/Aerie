// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventsFor, presetTargets, resolveTracks, type PlanToy } from './toy-remote-plan';
import { isRedWord } from './safeword';

const FLEXER: PlanToy = {
  toyId: 'flex1',
  commands: ['VIBRATE', 'VIBRATE1', 'VIBRATE2', 'FLEXER_VIBRATE', 'FLEXER_FINGER', 'PRESET', 'BATTERY'],
};
const FERRI: PlanToy = { toyId: 'ferri1', commands: ['VIBRATE', 'PRESET', 'BATTERY'] };

test('main is each toy\'s first motor, all is every motor, and names match commands or labels', () => {
  const main = resolveTracks({ tracks: { main: [[10, 1000]] } }, [FLEXER, FERRI]);
  assert.deepEqual(main.motors.map((m) => `${m.toyId}:${m.command}`), ['flex1:FLEXER_VIBRATE', 'ferri1:VIBRATE']);
  const all = resolveTracks({ toyId: 'flex1', tracks: { all: [[5, 1000]] } }, [FLEXER, FERRI]);
  assert.deepEqual(all.motors.map((m) => m.command), ['FLEXER_VIBRATE', 'FLEXER_FINGER']);
  const named = resolveTracks({ tracks: { Fingering: [[7, 500]], FLEXER_VIBRATE: [[3, 500]] } }, [FLEXER]);
  assert.deepEqual(named.motors.map((m) => m.command).sort(), ['FLEXER_FINGER', 'FLEXER_VIBRATE']);
  assert.deepEqual(named.unmatched, []);
});

test('a name that matches no motor is reported rather than guessed at', () => {
  const r = resolveTracks({ tracks: { thrust: [[10, 1000]], main: [[4, 1000]] } }, [FERRI]);
  assert.deepEqual(r.unmatched, ['thrust']);
  assert.equal(r.motors.length, 1);
});

test('a toyId narrows the command to that toy', () => {
  const r = resolveTracks({ toyId: 'ferri1', tracks: { main: [[4, 1000]] } }, [FLEXER, FERRI]);
  assert.deepEqual(r.motors.map((m) => m.toyId), ['ferri1']);
});

test('levels are clamped to the motor top', () => {
  const r = resolveTracks({ tracks: { main: [[99, 1000]] } }, [FERRI]);
  assert.equal(r.motors[0].steps[0][0], 20);
});

test('events change only when the level does, loop, and end in a zero', () => {
  const [motor] = resolveTracks({ tracks: { main: [[4, 1000], [4, 1000], [12, 500]] } }, [FERRI]).motors;
  assert.deepEqual(eventsFor([motor], 2, 10_000).map((e) => [e.at, e.level]), [
    [0, 4],
    [2000, 12],
    [2500, 4],
    [4500, 12],
    [5000, 0],
  ]);
});

test('nothing runs past maxMs, and the cut is a zero at maxMs', () => {
  const [motor] = resolveTracks({ tracks: { main: [[8, 60_000]] } }, [FERRI]).motors;
  assert.deepEqual(eventsFor([motor], 5, 90_000).map((e) => [e.at, e.level]), [
    [0, 8],
    [90_000, 0],
  ]);
});

test('two motors interleave in time order', () => {
  const { motors } = resolveTracks({ tracks: { vibration: [[6, 1000]], fingering: [[0, 500], [9, 500]] } }, [FLEXER]);
  assert.deepEqual(eventsFor(motors, 1, 5000).map((e) => [e.at, e.command, e.level]), [
    [0, 'FLEXER_VIBRATE', 6],
    [0, 'FLEXER_FINGER', 0],
    [500, 'FLEXER_FINGER', 9],
    [1000, 'FLEXER_VIBRATE', 0],
    [1000, 'FLEXER_FINGER', 0],
  ]);
});

test('a preset only goes to toys that keep that pattern', () => {
  assert.deepEqual(presetTargets({ preset: 2 }, [FLEXER, FERRI]).map((t) => t.toyId), ['flex1', 'ferri1']);
  assert.deepEqual(presetTargets({ preset: 2 }, [{ toyId: 'x', commands: ['VIBRATE'] }]), []);
  assert.deepEqual(presetTargets({ preset: 9 }, [FLEXER]), []);
});

test('red on its own is the word, and a sentence with red in it is not', () => {
  for (const said of ['red', 'Red', 'RED', '*red*', 'red.', 'red!!', ' red ', 'red red', '"red"']) assert.equal(isRedWord(said), true, said);
  for (const said of ['the red one', 'red light', 'bored', 'redo', 'reddish', '', 'stop']) assert.equal(isRedWord(said), false, said);
});
