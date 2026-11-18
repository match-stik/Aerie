// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The Lovense app road's bridge: a page moving a level many times a second
// becomes a few sends, every motor of a toy in one, a held level said again
// before it runs out, zero as a stop, and their stop first and holding.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { commandsForToyName, createCloudBridge, HOLD_MS, RESEND_AFTER_MS, SEND_GAP_MS } from './lovense-cloud-bridge';

let sent: { url: string; body: Record<string, unknown> }[] = [];
let answer: Record<string, unknown> = { ok: true };
const transport = {
  get: async () => ({ hasToken: true, toys: [{ id: 't1', name: 'flexer', nickName: '', connected: true }, { id: 't2', name: 'fizz', nickName: '', connected: false }] }),
  post: async (url: string, body: unknown) => { sent.push({ url, body: body as Record<string, unknown> }); return answer; },
};

async function tick(ms: number): Promise<void> {
  mock.timers.tick(ms);
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  sent = [];
  answer = { ok: true };
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
});
afterEach(() => mock.timers.reset());

test('toy names give the motors the phone would draw', () => {
  assert.deepEqual(commandsForToyName('flexer'), ['FLEXER_VIBRATE', 'FLEXER_FINGER', 'PRESET']);
  assert.deepEqual(commandsForToyName('edge'), ['VIBRATE1', 'VIBRATE2', 'PRESET']);
  assert.deepEqual(commandsForToyName('fizz'), ['VIBRATE', 'PRESET']);
});

test('the house list reads as toys, and the token never comes to the page', async () => {
  const b = createCloudBridge(transport);
  const s = await b.setToken({ token: 'secret' });
  assert.equal(s.tokenSet, true);
  assert.equal(s.toys[0].toyId, 't1');
  assert.equal(s.toys[0].name, 'Flexer');
  assert.equal(s.toys[1].connected, false);
  assert.equal(sent.length, 0);
});

test('a burst of moves becomes one send per gap, both motors in it, newest wins', async () => {
  const b = createCloudBridge(transport);
  for (let level = 1; level <= 10; level += 1) await b.command({ toyId: 't1', command: 'FLEXER_VIBRATE', level });
  await b.command({ toyId: 't1', command: 'FLEXER_FINGER', level: 7 });
  await tick(0);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body, { toy: 't1', action: 'Vibrate:10,Fingering:7', timeSec: 20 });
  await b.command({ toyId: 't1', command: 'FLEXER_VIBRATE', level: 12 });
  await b.command({ toyId: 't1', command: 'FLEXER_VIBRATE', level: 13 });
  await tick(SEND_GAP_MS - 10);
  assert.equal(sent.length, 1);
  await tick(10);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].body.action, 'Vibrate:13,Fingering:7');
  // One motor to zero while the other runs: named as zero, never left out,
  // because a send no longer stops the one before it.
  await b.command({ toyId: 't1', command: 'FLEXER_VIBRATE', level: 0 });
  await tick(SEND_GAP_MS);
  assert.equal(sent[2].body.action, 'Vibrate:0,Fingering:7');
});

test('a level that stays put is said again before it runs out; zero is a stop, then quiet', async () => {
  const b = createCloudBridge(transport);
  await b.command({ toyId: 't1', command: 'FLEXER_VIBRATE', level: 5 });
  await tick(0);
  await tick(RESEND_AFTER_MS);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].body.action, 'Vibrate:5');
  await b.command({ toyId: 't1', command: 'FLEXER_VIBRATE', level: 0 });
  await tick(SEND_GAP_MS);
  assert.deepEqual(sent[2].body, { toy: 't1', action: 'Stop' });
  await tick(RESEND_AFTER_MS * 3);
  assert.equal(sent.length, 3);
  assert.deepEqual(b.pendingForTest(), []);
});

test('a zero for a toy with nothing going sends nothing', async () => {
  const b = createCloudBridge(transport);
  await b.command({ toyId: 't1', command: 'FLEXER_VIBRATE', level: 0 });
  await tick(SEND_GAP_MS * 3);
  assert.equal(sent.length, 0);
});

test('a toy\'s own pattern goes as a preset, and a light moves nothing', async () => {
  const b = createCloudBridge(transport);
  await b.command({ toyId: 't1', command: 'ALIGHT_ON' });
  await b.command({ toyId: 't1', command: 'PRESET', level: 3 });
  await tick(0);
  assert.deepEqual(sent[0].body, { toy: 't1', preset: 3, timeSec: 60 });
});

test('their stop goes at once, drops what was gathered, and holds', async () => {
  const b = createCloudBridge(transport);
  let stopped = 0;
  await b.addListener('stopped', () => { stopped += 1; });
  await b.command({ toyId: 't1', command: 'FLEXER_VIBRATE', level: 9 });
  await tick(0);
  await b.command({ toyId: 't1', command: 'FLEXER_VIBRATE', level: 15 });
  await b.stop();
  assert.equal(stopped, 1);
  assert.equal(sent[sent.length - 1].url, '/api/toys/cloud/stop');
  await assert.rejects(b.command({ toyId: 't1', command: 'FLEXER_VIBRATE', level: 4 }), (e: { code?: string }) => e.code === 'HELD');
  await tick(SEND_GAP_MS * 2);
  assert.equal(sent.filter((s) => s.url === '/api/toys/cloud/play').length, 1);
  await tick(HOLD_MS);
  await b.command({ toyId: 't1', command: 'FLEXER_VIBRATE', level: 4 });
  await tick(0);
  assert.equal(sent[sent.length - 1].body.action, 'Vibrate:4');
});

test('when Lovense says slow down the bridge waits instead of piling on', async () => {
  const b = createCloudBridge(transport);
  answer = { ok: false, slow: true };
  await b.command({ toyId: 't1', command: 'FLEXER_VIBRATE', level: 6 });
  await tick(0);
  await tick(SEND_GAP_MS * 3);
  assert.equal(sent.length, 1);
  answer = { ok: true };
  await tick(2000);
  assert.equal(sent.length, 2);
});
