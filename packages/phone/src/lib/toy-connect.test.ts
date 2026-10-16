// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// One tap of Connect followed to its end: what ends it, when Connect comes
// back, how tries are counted, and what the record says.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createConnectTracker, type ConnectEnd, type ConnectRecord } from './toy-connect';

interface Timer { at: number; fn: () => void; done?: boolean; cancelled?: boolean }

function harness(opts: {
  connect?: (toyId: string) => Promise<unknown>;
  read?: (toyId: string) => { connected: boolean; commands: number } | null;
  maxSteps?: number;
} = {}) {
  let clock = 1_000;
  const timers: Timer[] = [];
  const reports: ConnectRecord[] = [];
  const ends: ConnectEnd[] = [];
  const tracker = createConnectTracker({
    now: () => clock,
    later: (fn, ms) => {
      const timer: Timer = { at: clock + ms, fn };
      timers.push(timer);
      return timer;
    },
    cancel: (h) => { (h as Timer).cancelled = true; },
    connect: opts.connect ?? (async () => {}),
    readToy: async (toyId) => (opts.read ? opts.read(toyId) : { connected: false, commands: 0 }),
    report: (r) => { reports.push(r); },
    ...(opts.maxSteps ? { maxSteps: opts.maxSteps } : {}),
  });
  tracker.onEnded((e) => { ends.push(e); });
  const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  };
  const advance = async (ms: number) => {
    const target = clock + ms;
    for (;;) {
      const due = timers.filter((t) => !t.done && !t.cancelled && t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      clock = due.at;
      due.done = true;
      due.fn();
      await flush();
    }
    clock = target;
    await flush();
  };
  const ctx = { name: 'Fizz', scanning: false, bluetoothOn: true, tokenSet: true, shownConnected: false };
  return { tracker, reports, ends, flush, advance, ctx };
}

const whats = (r: ConnectRecord) => r.steps.map((s) => (s[2] ? `${s[1]}:${s[2]}` : s[1]));

test('connecting is not the end: Connect waits, comes back after a few seconds, and connected ends it', async () => {
  const h = harness({ read: () => ({ connected: true, commands: 6 }) });
  h.tracker.start('fz', h.ctx);
  await h.flush();
  assert.deepEqual(h.tracker.view().fz, { connecting: true, canTapAgain: false, tries: 1 });
  h.tracker.connection('fz', 'connecting');
  assert.equal(h.tracker.view().fz?.connecting, true, 'the SDK saying connecting leaves the spinner on');
  assert.deepEqual(h.ends, []);
  await h.advance(5_000);
  assert.equal(h.tracker.view().fz?.canTapAgain, true, 'Connect comes back so the owner can tap again');
  h.tracker.connection('fz', 'connected');
  assert.deepEqual(h.ends, [{ toyId: 'fz', outcome: 'connected', tries: 1 }]);
  assert.equal(h.tracker.view().fz, undefined);
  h.tracker.connection('fz', 'service_discovered');
  assert.equal(h.reports.length, 0, 'the record stays open a little for what comes after');
  await h.advance(10_000);
  assert.equal(h.reports.length, 1);
  const [record] = h.reports;
  assert.equal(record.outcome, 'connected');
  assert.equal(record.ms, 5_000);
  assert.deepEqual(whats(record), ['tap', 'asked', 'cb:connecting', 'cb:connected', 'cb:service_discovered']);
  assert.deepEqual(record.after, { connected: true, commands: 6 });
  assert.deepEqual(record.ctx, { scanning: false, bluetoothOn: true, tokenSet: true, shownConnected: false });
});

test('an error for the toy ends the attempt instead of leaving Connect greyed', async () => {
  const h = harness();
  h.tracker.start('fz', h.ctx);
  h.tracker.start('fl', { ...h.ctx, name: 'Flexer' });
  await h.flush();
  h.tracker.error({ code: 3, message: 'search failed' });
  assert.equal(h.tracker.view().fz?.connecting, true, 'an error with no toy named ends nothing');
  h.tracker.error({ toyId: 'fz', code: 29, message: 'connect failed' });
  assert.deepEqual(h.ends, [{ toyId: 'fz', outcome: 'error', tries: 1, detail: '29 connect failed' }]);
  assert.equal(h.tracker.view().fz, undefined);
  assert.equal(h.tracker.view().fl?.connecting, true);
  await h.advance(10_000);
  assert.deepEqual(whats(h.reports[0]), ['tap', 'asked', 'error, no toy:3 search failed', 'error:29 connect failed']);
});

test('an attempt with no answer gives up, reads the toy list once, and says which it was', async () => {
  const quiet = harness({ read: () => ({ connected: false, commands: 0 }) });
  quiet.tracker.start('fz', quiet.ctx);
  await quiet.advance(24_999);
  assert.equal(quiet.tracker.view().fz?.connecting, true);
  await quiet.advance(1);
  assert.deepEqual(quiet.ends.map((e) => e.outcome), ['timeout']);
  assert.equal(quiet.tracker.view().fz, undefined, 'Connect is back without leaving the page');

  const already = harness({ read: () => ({ connected: true, commands: 4 }) });
  already.tracker.start('fz', already.ctx);
  await already.advance(25_000);
  assert.deepEqual(already.ends.map((e) => e.outcome), ['connected-quietly'], 'connected with no callback is said so');
  await already.advance(10_000);
  assert.deepEqual(whats(already.reports[0]), ['tap', 'asked', 'no answer', 'read:connected=true commands=4']);
});

test('tries in a row are numbered, and a connection starts the count again', async () => {
  const h = harness();
  h.tracker.start('fz', h.ctx);
  await h.advance(25_000);
  h.tracker.start('fz', h.ctx);
  assert.equal(h.tracker.view().fz?.tries, 2);
  h.tracker.connection('fz', 'failed');
  h.tracker.start('fz', h.ctx);
  assert.equal(h.tracker.view().fz?.tries, 3);
  h.tracker.connection('fz', 'connected');
  await h.advance(10_000);
  assert.deepEqual(h.reports.map((r) => [r.try, r.outcome]), [[1, 'timeout'], [2, 'failed'], [3, 'connected']]);
  h.tracker.start('fz', h.ctx);
  assert.equal(h.tracker.view().fz?.tries, 1, 'after a connection the next tap is a first try');
  h.tracker.connection('fz', 'failed');
  await h.advance(6 * 60_000);
  h.tracker.start('fz', h.ctx);
  assert.equal(h.tracker.view().fz?.tries, 1, 'and so is a tap long after a miss');
});

test('tapping again before an attempt ends closes the first as tapped again, sent at once', async () => {
  const h = harness();
  h.tracker.start('fz', h.ctx);
  await h.advance(6_000);
  h.tracker.start('fz', h.ctx);
  assert.equal(h.reports.length, 1);
  assert.equal(h.reports[0].outcome, 'tapped-again');
  assert.equal(h.reports[0].try, 1);
  assert.deepEqual(h.tracker.view().fz, { connecting: true, canTapAgain: false, tries: 2 });
});

test('a connect the bridge refuses ends at once with the bridge\'s own words', async () => {
  const h = harness({ connect: async () => { throw new Error('Could not connect: no adapter'); } });
  h.tracker.start('fz', h.ctx);
  await h.flush();
  assert.deepEqual(h.ends, [{ toyId: 'fz', outcome: 'refused', tries: 1, detail: 'Could not connect: no adapter' }]);
});

test('a callback after the record went is sent on its own as late, and not long after', async () => {
  const h = harness();
  h.tracker.start('fz', h.ctx);
  await h.advance(25_000);
  await h.advance(10_000);
  assert.equal(h.reports.length, 1);
  await h.advance(5_000);
  h.tracker.connection('fz', 'connected');
  assert.equal(h.reports.length, 2);
  assert.equal(h.reports[1].kind, 'late');
  assert.equal(h.reports[1].outcome, 'timeout');
  assert.deepEqual(h.reports[1].steps, [[15_000, 'cb', 'connected']]);
  await h.advance(3 * 60_000);
  h.tracker.connection('fz', 'failed');
  assert.equal(h.reports.length, 2, 'an ordinary event long after is not sent');
  h.tracker.connection('never-tapped', 'connected');
  assert.equal(h.reports.length, 2);
});

test('a search finding the toy is written down when what it says changes, and steps are capped', async () => {
  const h = harness({ maxSteps: 8 });
  h.tracker.found('fz', false, -71);
  await h.advance(4_000);
  h.tracker.start('fz', { ...h.ctx, scanning: true });
  await h.flush();
  h.tracker.found('fz', false, -70);
  h.tracker.found('fz', false, -69);
  h.tracker.found('fz', true, -65);
  h.tracker.search('finished');
  h.tracker.page(false);
  h.tracker.page(true);
  h.tracker.connection('fz', 'connecting');
  h.tracker.connection('fz', 'connecting');
  h.tracker.connection('fz', 'connected');
  await h.advance(10_000);
  const [record] = h.reports;
  assert.deepEqual(record.found, { agoMs: 4_000, rssi: -71 });
  assert.equal(record.ctx?.scanning, true);
  assert.deepEqual(whats(record), ['tap', 'asked', 'found:not connected', 'found:connected', 'search finished', 'page left', 'page back', 'cb:connecting']);
  assert.equal(record.dropped, 2);
});

test('the Toys page hands every tap to the tracker and no longer ends a connect on its own', () => {
  const page = readFileSync(new URL('../components/ToysApp.tsx', import.meta.url), 'utf8');
  assert.match(page, /startToyConnect\(/);
  assert.match(page, /onToyConnectEnded\(/);
  assert.doesNotMatch(page, /setConnecting\(/, 'a connection callback, connecting included, used to clear the spinner');
});
