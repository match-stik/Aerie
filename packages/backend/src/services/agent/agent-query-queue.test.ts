// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A message of theirs that queues behind a running turn (a picture, a sticker,
// or a note while a bell rings in another room) waits the turn out rather than
// being answered with the timeout string and no turn at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryQueue, QUEUE_TIMEOUT_MESSAGE, queueTimeoutFor } from './agent-query-queue.js';

function deferred() {
  let resolve!: (v: string) => void;
  const promise = new Promise<string>((r) => { resolve = r; });
  return { promise, resolve };
}

async function waitedBehindLongTurn(timeoutMs: number): Promise<string> {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const queue = new QueryQueue();
    const bell = deferred();
    const running = queue.enqueue(3, () => bell.promise);
    const theirs = queue.enqueue(0, async () => 'answered', timeoutMs);
    now += 5 * 60_000; // the bell runs five minutes
    bell.resolve('bell done');
    await running;
    return await theirs;
  } finally {
    Date.now = realNow;
  }
}

test('their phone message queued behind a five-minute bell still gets its turn', async () => {
  assert.equal(await waitedBehindLongTurn(queueTimeoutFor('web')), 'answered');
});

test('a Telegram message of theirs waits too', async () => {
  assert.equal(await waitedBehindLongTurn(queueTimeoutFor('telegram')), 'answered');
});

test('other platforms keep the short wait', async () => {
  assert.equal(await waitedBehindLongTurn(queueTimeoutFor('discord')), QUEUE_TIMEOUT_MESSAGE);
});
