// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// What they start keeps playing after they leave the Toys page (theirs, Nov 10 2026).
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { LovenseToy } from './lovense-toys';
import { lendDriver, noteOwnPreset, ownDrives, ownPlaying, ownPlayTestSeam, playOwnPattern, setOwnLoop, stopOwn } from './own-play';

const FLEXER: LovenseToy = { toyId: 'x1', name: 'Flexer', connected: true, commands: ['FLEXER_VIBRATE', 'FLEXER_FINGER', 'PRESET'] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => ownPlayTestSeam.reset());

test('a shelf pattern plays through the page, and keeps playing when the page lets go', async () => {
  const sent: string[] = [];
  const release = lendDriver((toyId, command, level) => sent.push(`${toyId}:${command}=${level}`));
  assert.equal(playOwnPattern({ id: 'p', name: 'Ember', tracks: { motor1: [[10, 400], [5, 400]] } }, [FLEXER]), null);
  await sleep(50);
  assert.ok(sent.some((s) => s.endsWith('=10')), `sent ${sent.join(' ')}`);
  release();
  assert.equal(ownPlaying()?.name, 'Ember', 'leaving the page does not stop it');
  assert.ok(ownDrives('x1:FLEXER_VIBRATE'));
  stopOwn(false);
  assert.equal(ownPlaying(), null);
  assert.equal(ownDrives('x1:FLEXER_VIBRATE'), false);
});

test('with no toy it says so, and a stored pattern is remembered until it is turned off', () => {
  assert.match(playOwnPattern({ id: 'p', name: 'x', tracks: { motor1: [[10, 100]] } }, []) ?? '', /Connect a toy/);
  noteOwnPreset('x1', 'Flexer', 5);
  assert.equal(ownPlaying()?.preset, 5);
  assert.ok(ownDrives('x1:PRESET'));
  noteOwnPreset('x1', 'Flexer', 0);
  assert.equal(ownPlaying(), null);
});

test('a looping pattern goes round again', async () => {
  const sent: number[] = [];
  lendDriver((_t, _c, level) => sent.push(level));
  setOwnLoop(true);
  playOwnPattern({ id: 'p', name: 'Loop', tracks: { motor1: [[8, 60]] } }, [FLEXER]);
  await sleep(200);
  assert.ok(sent.filter((l) => l === 8).length >= 2, `levels ${sent.join(',')}`);
  stopOwn(true);
  assert.equal(sent[sent.length - 1], 0, 'stopping zeroes what it drove');
});
