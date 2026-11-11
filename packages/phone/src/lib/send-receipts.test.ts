// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A send is watched until the house sends it back: back in time is landed,
// not back is offered again, and a late copy clears the offer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSendWatch, failedSendPreview, type WatchedSend } from './send-receipts';

function harness() {
  const timers: Array<{ fn: () => void; cancelled: boolean }> = [];
  const unqueued: string[] = [];
  const watch = createSendWatch({
    timeoutMs: 100,
    schedule: (fn) => { const t = { fn, cancelled: false }; timers.push(t); return t; },
    cancel: (h) => { (h as { cancelled: boolean }).cancelled = true; },
    unqueue: (n) => unqueued.push(n),
  });
  const fire = () => { for (const t of timers.splice(0)) if (!t.cancelled) t.fn(); };
  return { watch, fire, unqueued };
}

const send = (nonce: string, content = 'hi all'): WatchedSend => ({
  nonce, threadId: 't1', content, contentType: 'text', metadata: { clientNonce: nonce }, sentAt: 0,
});

test('a send the house never sends back is offered again, and taken off the reconnect queue', () => {
  const h = harness();
  h.watch.watch(send('a'));
  assert.equal(h.watch.failed().length, 0);
  h.fire();
  assert.deepEqual(h.watch.failed().map((f) => f.nonce), ['a']);
  assert.deepEqual(h.unqueued, ['a']);
});

test('a send that comes back in time is never offered', () => {
  const h = harness();
  h.watch.watch(send('b'));
  assert.equal(h.watch.heard('b'), true);
  h.fire();
  assert.equal(h.watch.failed().length, 0);
  assert.equal(h.watch.waitingCount(), 0);
});

test('a copy that turns up late clears the offer, so it is not sent twice', () => {
  const h = harness();
  h.watch.watch(send('c'));
  h.fire();
  assert.equal(h.watch.failed().length, 1);
  assert.equal(h.watch.heard('c'), true);
  assert.equal(h.watch.failed().length, 0);
});

test('a retry takes the send off the list and keeps it whole', () => {
  const h = harness();
  h.watch.watch({ ...send('d', ''), metadata: { clientNonce: 'd', attachments: [{}, {}] } });
  h.fire();
  const taken = h.watch.take('d');
  assert.equal(taken?.nonce, 'd');
  assert.equal(failedSendPreview(taken!), '2 pictures');
  assert.equal(h.watch.failed().length, 0);
  assert.equal(h.watch.take('d'), null);
});

test('messages from anybody else, or with no tag, change nothing', () => {
  const h = harness();
  h.watch.watch(send('e'));
  assert.equal(h.watch.heard(undefined), false);
  assert.equal(h.watch.heard('somebody-else'), false);
  h.fire();
  assert.equal(h.watch.failed().length, 1);
});

test('a send can be given a shorter wait, for when the phone already knows it is offline', () => {
  const waits: number[] = [];
  const watch = createSendWatch({ timeoutMs: 12_000, schedule: (_fn, ms) => { waits.push(ms); return {}; }, cancel: () => {} });
  watch.watch(send('f'), 1_500);
  watch.watch(send('g'));
  assert.deepEqual(waits, [1_500, 12_000]);
});
