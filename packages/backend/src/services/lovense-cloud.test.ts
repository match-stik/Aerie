// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ToyRemoteCommand } from '@aerie/shared';
import { cloudAction, cloudDisconnect, cloudLink, cloudPlayByHand, resetHandPaceForTests, shapeHandPlay, commandToCloud, cloudStopNow, relayToCloud, timelineFor, STEP_MIN_GAP_MS, setCloudOpen, useCloudFetchForTest, useCloudStoreForTest, resetCloudForTests } from './lovense-cloud.js';

let uidRow: string | null = 'aerie-test';
useCloudStoreForTest({ token: () => 'tok', readUid: () => uidRow, writeUid: (id) => { uidRow = id; } });

const base = { id: 'c1', companion: 'birch', at: '2026-11-18T00:00:00Z' };

test('motor names map to Lovense actions', () => {
  assert.equal(cloudAction('main'), 'Vibrate');
  assert.equal(cloudAction('FLEXER_FINGER'), 'Fingering');
  assert.equal(cloudAction('FLEXER_VIBRATE'), 'Vibrate');
  assert.equal(cloudAction('vibrate2'), 'Vibrate2');
  assert.equal(cloudAction('all'), 'All');
  assert.equal(cloudAction('SUCTION'), 'Suction');
});

test('a held level is one Function with a time, never 0', () => {
  const c = { ...base, action: 'play', tracks: { main: [[12, 30_000]] }, loops: 1, maxMs: 30_000 } as ToyRemoteCommand;
  const out = commandToCloud(c);
  assert.ok(out.ok);
  assert.deepEqual(out.ok && out.payload, { command: 'Function', action: 'Vibrate:12', timeSec: 30 });
  const short = commandToCloud({ ...c, maxMs: 200 });
  assert.ok(short.ok && short.payload.timeSec === 1);
});

test('two held motors go in one action', () => {
  const c = { ...base, action: 'play', tracks: { FLEXER_VIBRATE: [[5, 10_000]], FLEXER_FINGER: [[9, 10_000]] }, loops: 1, maxMs: 10_000 } as ToyRemoteCommand;
  const out = commandToCloud(c);
  assert.ok(out.ok && out.payload.action === 'Vibrate:5,Fingering:9');
});

test('a moving pattern is stepped by the house: every motor named at each change, no Pattern command, a stop at the end', () => {
  const c = { ...base, action: 'play', tracks: { vibration: [[0, 3000], [1, 9000], [4, 8000]], fingering: [[6, 10_000], [0, 10_000]] }, loops: 1, maxMs: 20_000 } as ToyRemoteCommand;
  const out = commandToCloud(c);
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.deepEqual(out.payload, { command: 'Function', action: 'Vibrate:0,Fingering:6', timeSec: 4, stopPrevious: 0 });
  const later = out.later ?? [];
  assert.deepEqual(later.map((s) => [s.atMs, s.payload.action]), [[3000, 'Vibrate:1,Fingering:6'], [10_000, 'Vibrate:1,Fingering:0'], [12_000, 'Vibrate:4,Fingering:0'], [20_000, 'Stop']]);
  assert.ok(later.every((s) => s.payload.command === 'Function'));
});

test('a quick pattern never sends closer than the gap, and loops by its own length', () => {
  const tl = timelineFor([['main', [[2, 100], [8, 100]]]], 2000);
  for (let i = 1; i < tl.length; i += 1) assert.ok(tl[i].atMs - tl[i - 1].atMs >= STEP_MIN_GAP_MS);
  const looped = timelineFor([['main', [[2, 1000], [8, 1000]]]], 6000);
  assert.deepEqual(looped.map((p) => p.atMs), [0, 1000, 2000, 3000, 4000, 5000]);
});

test('a new play or their stop cancels what was still stepping', async () => {
  resetCloudForTests();
  const sent: Record<string, unknown>[] = [];
  useCloudFetchForTest(async (_url, body) => { sent.push(body); return { result: true, code: 200 }; });
  await setCloudOpen(true);
  const ramp = { ...base, action: 'play', tracks: { main: [[1, 50], [2, 400], [3, 400]] }, loops: 1, maxMs: 850 } as ToyRemoteCommand;
  await relayToCloud(ramp);
  assert.equal(sent.length, 1);
  await cloudStopNow();
  const afterStop = sent.length;
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(sent.length, afterStop);
  useCloudFetchForTest(null);
  resetCloudForTests();
});

test('presets, stop, and lights', () => {
  assert.deepEqual((commandToCloud({ ...base, action: 'play', preset: 2, presetMs: 20_000, maxMs: 20_000 } as ToyRemoteCommand) as { payload: unknown }).payload, { command: 'Preset', name: 'wave', timeSec: 20 });
  assert.deepEqual((commandToCloud({ ...base, action: 'stop', maxMs: 0 } as ToyRemoteCommand) as { payload: unknown }).payload, { command: 'Function', action: 'Stop', timeSec: 0 });
  assert.equal(commandToCloud({ ...base, action: 'light', light: { action: 'on' }, maxMs: 0 } as ToyRemoteCommand).ok, false);
});

test('a closed road refuses a play and lets a stop through; offline reads plainly', async () => {
  resetCloudForTests();
  const sent: Record<string, unknown>[] = [];
  useCloudFetchForTest(async (_url, body) => { sent.push(body); return { result: false, code: 507, message: 'Lovense APP is offline!' }; });
  const play = { ...base, action: 'play', tracks: { main: [[8, 5000]] }, loops: 1, maxMs: 5000 } as ToyRemoteCommand;
  const closed = await relayToCloud(play);
  assert.equal(closed.ok, false);
  assert.equal(closed.reason, 'closed');
  assert.equal(sent.length, 0);
  useCloudFetchForTest(null);
  resetCloudForTests();
});

test('an open road plays, offline reads plainly, closing stops, disconnect rotates the id', async () => {
  resetCloudForTests();
  const sent: Record<string, unknown>[] = [];
  let reply: { result: boolean; code: number; message?: string } = { result: true, code: 200 };
  useCloudFetchForTest(async (_url, body) => { sent.push(body); return reply; });
  await setCloudOpen(true);
  assert.equal(sent.length, 0, 'opening the road calls nothing');
  const play = { ...base, action: 'play', tracks: { main: [[8, 5000]] }, loops: 1, maxMs: 5000 } as ToyRemoteCommand;
  const ok = await relayToCloud(play);
  assert.ok(ok.ok && ok.playing && ok.playing.companion === 'birch');
  assert.equal(sent[0].action, 'Vibrate:8');
  assert.equal(sent[0].uid, 'aerie-test');
  assert.equal(sent[0].token, 'tok');
  reply = { result: false, code: 507, message: 'Lovense APP is offline!' };
  const off = await relayToCloud(play);
  assert.equal(off.ok, false);
  assert.equal(off.reason, 'no-bridge');
  reply = { result: true, code: 200 };
  sent.length = 0;
  await setCloudOpen(false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].action, 'Stop');
  await cloudDisconnect();
  assert.notEqual(uidRow, 'aerie-test');
  useCloudFetchForTest(null);
  resetCloudForTests();
});

test('the callback keeps a toy list only for this house\'s own id', async () => {
  const { recordCloudCallback, cloudStatus } = await import('./lovense-cloud.js');
  resetCloudForTests();
  uidRow = 'aerie-test';
  assert.equal(recordCloudCallback({ uid: 'someone-else', toys: { a: { id: 'a', name: 'fizz', nickName: 'Fizz', status: 1 } } }), false);
  assert.equal(cloudStatus().toys, null);
  assert.equal(recordCloudCallback({ uid: 'aerie-test', toys: { a: { id: 'a', name: 'fizz', nickName: 'Fizz', status: 1 } } }), true);
  assert.deepEqual(cloudStatus().toys, [{ id: 'a', name: 'fizz', nickName: 'Fizz', connected: true }]);
  assert.equal(recordCloudCallback({ uid: 'aerie-test', toys: '{"b":{"id":"b","name":"flexer","status":0}}' }), true);
  assert.equal((cloudStatus().toys ?? [])[0].connected, false);
  resetCloudForTests();
});

test('their own sends: checked, capped, a toy by id, a stop never too quick', async () => {
  assert.deepEqual(shapeHandPlay({ action: 'Vibrate:25,Fingering:9', timeSec: 999, toy: 'abc123' }), { ok: true, payload: { toy: 'abc123', command: 'Function', action: 'Vibrate:20,Fingering:9', timeSec: 60, stopPrevious: 0 } });
  assert.deepEqual(shapeHandPlay({ preset: 2 }), { ok: true, payload: { command: 'Preset', name: 'wave', timeSec: 20 } });
  assert.equal(shapeHandPlay({ action: 'Explode:5' }).ok, false);
  assert.equal(shapeHandPlay({ action: 'Vibrate:5', toy: 'x; drop' }).ok, false);
  assert.equal(shapeHandPlay({ preset: 9 }).ok, false);
  const s = shapeHandPlay({ action: 'Vibrate:5', timeSec: 0 });
  assert.ok(s.ok && s.payload.timeSec === 1);
  resetCloudForTests();
  resetHandPaceForTests();
  const sent: Record<string, unknown>[] = [];
  useCloudFetchForTest(async (_url, body) => { sent.push(body); return { result: true, code: 200 }; });
  assert.equal((await cloudPlayByHand({ action: 'Vibrate:5' })).ok, true);
  const quick = await cloudPlayByHand({ action: 'Vibrate:6' });
  assert.equal(quick.ok, false);
  assert.equal(quick.slow, true);
  assert.equal((await cloudPlayByHand({ action: 'Stop' })).ok, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].action, 'Stop');
  useCloudFetchForTest(null);
});

test('a second Get link inside a minute hands back the same link without asking Lovense', async () => {
  resetCloudForTests();
  let asked = 0;
  useCloudFetchForTest(async () => { asked += 1; return { result: true, code: 0, data: { qr: `https://q/${asked}.jpg`, code: '123456' } }; });
  const a = await cloudLink();
  const b = await cloudLink();
  assert.equal(asked, 1);
  assert.deepEqual(a, b);
  await cloudDisconnect();
  const c = await cloudLink();
  assert.equal(asked, 2);
  assert.ok(c.ok && c.qr.endsWith('2.jpg'));
  useCloudFetchForTest(null);
});
