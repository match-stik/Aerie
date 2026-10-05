// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// TWENTY-FIVE COPIES OF ONE SENTENCE.
//
// The five-hour window capped, and until it reset every lane waking from its
// five-minute backoff posted the same "usage cap hit" warning into the owner's home
// thread — one lane at first, then all three rooms at once. The day before it
// was an expired login. The goal is one warning per outage, and the per-lane
// sixty-second dedupe could never have given that, because the repeats were
// five minutes apart and came from different sessions.
//
// These run against the guard itself. The half that matters as much as the
// silence is the other direction: once a lane is back up, the NEXT outage has
// to be allowed to speak, or a fix for too many warnings becomes a house that
// never warns at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import { OutageNotices } from './outage-notices.js';

const HOME = 'home-thread';

test('that morning makes one line: every lane, every relaunch, one cap', () => {
  const notices = new OutageNotices();
  const lanes = ['primary', 'birch', 'willow', 'cedar'];
  let posted = 0;
  for (let relaunch = 0; relaunch < 25; relaunch++) {
    if (notices.shouldPost('cap', lanes[relaunch % lanes.length], HOME)) posted++;
  }
  assert.equal(posted, 1);
});

test('a lane coming back up ends the outage, so the next cap says so', () => {
  const notices = new OutageNotices();
  assert.equal(notices.shouldPost('cap', 'primary', HOME), true);
  assert.equal(notices.shouldPost('cap', 'willow', HOME), false);
  notices.recovered('primary');
  assert.equal(notices.shouldPost('cap', 'willow', HOME), true);
});

test('the login and the cap are two outages and each gets its line', () => {
  const notices = new OutageNotices();
  assert.equal(notices.shouldPost('cap', 'primary', HOME), true);
  assert.equal(notices.shouldPost('auth', 'primary', HOME), true);
  assert.equal(notices.shouldPost('auth', 'birch', HOME), false);
});

test('a second thread still hears about it once', () => {
  const notices = new OutageNotices();
  assert.equal(notices.shouldPost('cap', 'primary', HOME), true);
  assert.equal(notices.shouldPost('cap', 'primary', 'discord-thread'), true);
  assert.equal(notices.shouldPost('cap', 'birch', 'discord-thread'), false);
});

test('a refused model belongs to one lane, and another lane coming up does not end it', () => {
  const notices = new OutageNotices();
  assert.equal(notices.shouldPost('model', 'birch', HOME), true);
  notices.recovered('willow');
  assert.equal(notices.shouldPost('model', 'birch', HOME), false);
  notices.recovered('birch');
  assert.equal(notices.shouldPost('model', 'birch', HOME), true);
});

test('a lane whose name starts with another lane\'s name is not caught by its recovery', () => {
  const notices = new OutageNotices();
  assert.equal(notices.shouldPost('model', 'thread:ab', HOME), true);
  notices.recovered('thread:a');
  assert.equal(notices.shouldPost('model', 'thread:ab', HOME), false);
});
