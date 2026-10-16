// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The connection log's lines: whole within the house's limits, and never a flood.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ConnectRecord } from './toy-connect';
import { CONNECT_LOG_WHERE, connectLogBody, createConnectLog, type ConnectLogBody } from './toy-connect-log';

const record = (over: Partial<ConnectRecord> = {}): ConnectRecord => ({
  kind: 'attempt',
  toyId: '7C:31:FA:A9:33:D7',
  name: 'Fizz',
  try: 2,
  outcome: 'timeout',
  ms: 25_000,
  ctx: { scanning: true, bluetoothOn: true, tokenSet: true, shownConnected: false },
  found: { agoMs: 3_400, rssi: -78 },
  steps: [[0, 'tap'], [12, 'asked'], [140, 'cb', 'connecting'], [25_000, 'no answer'], [25_020, 'read', 'connected=false commands=0']],
  after: { connected: false, commands: 0 },
  ...over,
});

test('one attempt is one line the house keeps whole, and says what it needs to', () => {
  const body = connectLogBody(record());
  assert.equal(body.where, CONNECT_LOG_WHERE);
  const summary = JSON.parse(body.message);
  assert.deepEqual(summary, {
    kind: 'attempt', toy: 'Fizz', id: '7C:31:FA:A9:33:D7', try: 2, outcome: 'timeout', ms: 25_000,
    scan: true, bt: true, token: true, shown: false, foundAgoS: 3, rssi: -78, after: { connected: false, commands: 0 },
  });
  assert.deepEqual(JSON.parse(body.stack), record().steps);
});

test('a long attempt still fits the house\'s limits, first steps and last steps kept', () => {
  const steps: ConnectRecord['steps'] = Array.from({ length: 40 }, (_, i) => [i * 1000, 'error', `${i} ${'x'.repeat(110)}`]);
  const body = connectLogBody(record({ steps, name: 'A very long name the owner gave their toy'.repeat(3) }));
  assert.ok(body.message.length <= 500, `message ${body.message.length}`);
  assert.ok(body.stack.length <= 2000, `stack ${body.stack.length}`);
  const kept = JSON.parse(body.stack) as [number, string, string?][];
  assert.equal(kept[0][0], 0);
  assert.equal(kept[kept.length - 1][0], 39_000);
  assert.ok(kept.some((s) => s[0] === -1 && /steps cut/.test(s[1])));
});

test('the same attempt again and again is folded, and the count rides on the next line', () => {
  let clock = 0;
  const posted: ConnectLogBody[] = [];
  const log = createConnectLog({ post: (b) => posted.push(b), now: () => clock });
  assert.equal(log.send(record()), 'sent');
  clock += 1_000;
  assert.equal(log.send(record()), 'folded');
  assert.equal(log.send(record({ try: 3 })), 'folded', 'the same steps on the next try fold too');
  assert.equal(log.send(record({ outcome: 'connected', steps: [[0, 'tap'], [900, 'cb', 'connected']] })), 'sent');
  assert.equal(posted.length, 2);
  assert.equal(JSON.parse(posted[1].message).folded, 2);
  clock += 11 * 60_000;
  assert.equal(log.send(record({ outcome: 'connected', steps: [[0, 'tap'], [900, 'cb', 'connected']] })), 'sent', 'after ten minutes it is news again');
});

test('no more than twelve lines in ten minutes, and the held ones are counted on the next', () => {
  let clock = 0;
  const posted: ConnectLogBody[] = [];
  const log = createConnectLog({ post: (b) => posted.push(b), now: () => clock });
  for (let i = 0; i < 20; i++) {
    log.send(record({ try: i, steps: [[0, 'tap'], [i, `step ${i}`]] }));
    clock += 1_000;
  }
  assert.equal(posted.length, 12);
  clock += 10 * 60_000;
  assert.equal(log.send(record({ steps: [[0, 'tap'], [1, 'new']] })), 'sent');
  assert.equal(JSON.parse(posted[12].message).held, 8);
});
