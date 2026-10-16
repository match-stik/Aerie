// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The owner toys' batteries: only a toy's own answer is a level, absent is not 0,
// and the asking runs while something wants it and stops when nothing does.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { batteryAnswer, batteryFields, createBatteryWatch } from './toy-battery';

function harness(connected: string[] = ['fizz', 'flex']) {
  let clock = 1_000_000;
  const asked: string[] = [];
  const intervals = new Map<number, () => void>();
  const laters: (() => void)[] = [];
  let next = 1;
  const watch = createBatteryWatch({
    ask: async (toyId) => { asked.push(toyId); },
    connectedToyIds: async () => connected,
    now: () => clock,
    every: (fn) => { const h = next++; intervals.set(h, fn); return h; },
    cancelEvery: (h) => { intervals.delete(h as number); },
    later: (fn) => { laters.push(fn); return laters.length; },
  });
  const settle = () => new Promise((r) => setImmediate(r));
  return {
    watch, asked, intervals, laters, settle,
    tick: (ms: number) => { clock += ms; },
    fireEvery: async () => { for (const fn of intervals.values()) fn(); await settle(); },
    fireLaters: async () => { for (const fn of laters.splice(0)) fn(); await settle(); },
  };
}

test('only a real level from a named toy is an answer', () => {
  assert.deepEqual(batteryAnswer({ toyId: 'fizz', level: 59, working: false }), { toyId: 'fizz', level: 59, working: false });
  assert.deepEqual(batteryAnswer({ toyId: 'flex', level: 80.4, working: true }), { toyId: 'flex', level: 80, working: true });
  for (const raw of [null, {}, { toyId: 'fizz' }, { toyId: '', level: 50 }, { toyId: 'fizz', level: -1 }, { toyId: 'fizz', level: 101 }, { toyId: 'fizz', level: Number.NaN }, { toyId: 'fizz', level: '50' }]) {
    assert.equal(batteryAnswer(raw), null, JSON.stringify(raw));
  }
});

test('a toy that has not answered has no battery at all, never a 0', () => {
  assert.deepEqual(batteryFields(undefined), {});
  assert.equal('battery' in batteryFields(undefined), false);
  assert.deepEqual(batteryFields({ level: 0, working: false, at: Date.UTC(2026, 9, 21, 13, 33) }), {
    battery: 0,
    batteryAt: '2026-10-21T13:33:00.000Z',
  });
  assert.deepEqual(batteryFields({ level: 59, working: true, at: Date.UTC(2026, 9, 21, 13, 33) }), {
    battery: 59,
    batteryAt: '2026-10-21T13:33:00.000Z',
    batteryWorking: true,
  });
});

test('a new level is kept and told at once; the same level again only once a minute', () => {
  const h = harness();
  let seen = 0;
  h.watch.subscribe(() => { seen++; });
  assert.equal(h.watch.record({ toyId: 'fizz', level: 29, working: false }), true);
  assert.equal(h.watch.reading('fizz')?.level, 29);
  assert.equal(seen, 1);
  h.tick(10_000);
  assert.equal(h.watch.record({ toyId: 'fizz', level: 29, working: false }), false, 'unchanged, and told ten seconds ago');
  assert.equal(h.watch.reading('fizz')?.at, 1_010_000, 'but the reading is still the newest answer');
  assert.equal(seen, 1);
  h.tick(50_000);
  assert.equal(h.watch.record({ toyId: 'fizz', level: 29, working: false }), true, 'unchanged, but the house has not heard in a minute');
  assert.equal(h.watch.record({ toyId: 'fizz', level: 59, working: false }), true);
  assert.equal(h.watch.view().fizz.level, 59);
  assert.equal(seen, 2);
  assert.equal(h.watch.record({ toyId: 'fizz', level: 59, working: true }), true, 'running is news too: it can read off');
  assert.equal(h.watch.record({ toyId: 'fizz', level: -1 }), false);
  assert.equal(h.watch.reading('fizz')?.level, 59);
});

test('the levels are asked while something wants them, and not once nothing does', async () => {
  const h = harness();
  h.watch.want('remote', true);
  await h.settle();
  assert.deepEqual(h.asked, ['fizz', 'flex'], 'asked at once when the remote is handed over');
  h.watch.want('page', true);
  await h.settle();
  assert.equal(h.intervals.size, 1, 'one timer however many want it');
  assert.deepEqual(h.asked, ['fizz', 'flex']);
  await h.fireEvery();
  assert.deepEqual(h.asked, ['fizz', 'flex', 'fizz', 'flex']);
  h.watch.want('remote', false);
  assert.equal(h.intervals.size, 1, 'the page still wants it');
  h.watch.want('page', false);
  assert.equal(h.intervals.size, 0);
  h.watch.want('page', false);
  assert.equal(h.intervals.size, 0);
});

test('a toy that just connected is asked once it has settled, once', async () => {
  const h = harness();
  h.watch.connected('fizz');
  h.watch.connected('fizz');
  assert.equal(h.laters.length, 1, 'connected then service discovered asks once');
  assert.deepEqual(h.asked, []);
  await h.fireLaters();
  assert.deepEqual(h.asked, ['fizz']);
  h.watch.connected('fizz');
  assert.equal(h.laters.length, 1, 'a later connection asks again');
});

test('a question that fails or throws is dropped quietly and asked again next round', async () => {
  let calls = 0;
  const intervals: (() => void)[] = [];
  const watch = createBatteryWatch({
    ask: (toyId) => {
      calls++;
      if (toyId === 'boom') throw new Error('bridge gone');
      return Promise.reject(new Error('not connected'));
    },
    connectedToyIds: async () => ['boom', 'nope'],
    now: () => 0,
    every: (fn) => { intervals.push(fn); return 1; },
    cancelEvery: () => {},
    later: () => 0,
  });
  watch.want('remote', true);
  await new Promise((r) => setImmediate(r));
  intervals[0]();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 4);
});
