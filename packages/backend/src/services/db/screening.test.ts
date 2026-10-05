// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { positionOf, sceneAt, sceneSince, MAX_LOOKBACK_MS, type ScreeningRow } from './screening.js';
import { parseSubtitles } from '../subtitles.js';

const EPISODE = parseSubtitles(`1
00:00:10,000 --> 00:00:12,000
Way back at the start.

2
00:01:00,000 --> 00:01:02,000
A minute in.

3
00:02:00,000 --> 00:02:02,000
Two minutes in.

4
00:02:30,000 --> 00:02:32,000
THE TWIST NOBODY HAS SEEN YET.

5
00:05:00,000 --> 00:05:02,000
The ending.
`);

function row(over: Partial<ScreeningRow> = {}): ScreeningRow {
  return {
    id: 's1', title: 'Test', source: null,
    cues_json: JSON.stringify(EPISODE),
    status: 'paused', position_ms: 0, started_at_ms: null, offset_ms: 0,
    created_at: '', updated_at: '', ...over,
  };
}

test('a paused clock is exactly where it was left', () => {
  assert.equal(positionOf(row({ status: 'paused', position_ms: 61_000 }), 9e12), 61_000);
});

test('a playing clock is position plus wall time since it started', () => {
  const r = row({ status: 'playing', position_ms: 60_000, started_at_ms: 1_000_000 });
  assert.equal(positionOf(r, 1_030_000), 90_000);
});

test('a playing clock survives a restart, because it is arithmetic not a counter', () => {
  // Nothing ticks. The same row read later simply reports a later position.
  const r = row({ status: 'playing', position_ms: 0, started_at_ms: 1_000_000 });
  assert.equal(positionOf(r, 1_000_000), 0);
  assert.equal(positionOf(r, 1_120_000), 120_000);
});

test('THE GUARD: nothing ahead of the clock is ever returned', () => {
  const scene = sceneAt(row({ position_ms: 125_000 }), 90_000);
  const texts = scene.cues.map((c) => c.text);
  assert.ok(texts.includes('Two minutes in.'), 'should have what just happened');
  assert.ok(!texts.includes('THE TWIST NOBODY HAS SEEN YET.'), 'returned a cue from the future');
  assert.ok(!texts.includes('The ending.'), 'returned the ending');
});

test('THE GUARD holds at an absurd lookback — there is no way to ask past it', () => {
  for (const lookback of [1, 90_000, MAX_LOOKBACK_MS, 9_999_999, Infinity, -5]) {
    const scene = sceneAt(row({ position_ms: 125_000 }), lookback as number);
    for (const cue of scene.cues) {
      assert.ok(cue.startMs <= 125_000, `lookback ${lookback} leaked a cue starting at ${cue.startMs}`);
    }
    assert.ok(scene.lookbackMs <= MAX_LOOKBACK_MS, 'window exceeded its own ceiling');
  }
});

test('THE GUARD holds while the clock is running, not only when parked', () => {
  const r = row({ status: 'playing', position_ms: 0, started_at_ms: 1_000_000 });
  const scene = sceneAt(r, MAX_LOOKBACK_MS, 1_125_000);
  assert.ok(!scene.cues.some((c) => c.startMs > 125_000), 'leaked a future cue on a live clock');
});

test('the lookback floor drops what is too far back', () => {
  const scene = sceneAt(row({ position_ms: 125_000 }), 30_000);
  assert.deepEqual(scene.cues.map((c) => c.text), ['Two minutes in.']);
});

test('a negative offset holds the file back against the picture', () => {
  // The file runs 40s ahead, so at clock 125s the owner is really seeing 85s.
  const scene = sceneAt(row({ position_ms: 125_000, offset_ms: -40_000 }), 90_000);
  const texts = scene.cues.map((c) => c.text);
  assert.ok(texts.includes('A minute in.'));
  assert.ok(!texts.includes('Two minutes in.'), 'offset was not applied before the comparison');
});

test('pastEnd only once the clock has run off the end of the file', () => {
  assert.equal(sceneAt(row({ position_ms: 125_000 })).pastEnd, false);
  assert.equal(sceneAt(row({ position_ms: 400_000 })).pastEnd, true);
});

// --- catching up on what went past between the owner's messages -----------
// The clamp must survive every one of these.

test('the catch-up returns everything between the mark and the clock', () => {
  const r = row({ position_ms: 149_000 });           // 2:29, a second short of the twist
  const scene = sceneSince(r, 60_000);    // last looked at 1:00
  assert.deepEqual(scene.cues.map((c) => c.text), ['A minute in.', 'Two minutes in.']);
});

test('THE CLAMP HOLDS: a catch-up cannot be asked to read forwards', () => {
  const r = row({ position_ms: 70_000 });            // the owner is 1:10 in
  // A floor ahead of the clock is the one way this could ever spoil anything.
  const scene = sceneSince(r, 999_000);
  assert.ok(scene.cues.every((c) => c.startMs <= 70_000), 'nothing past the clock');
  assert.ok(!scene.cues.some((c) => c.text.includes('TWIST')), 'the twist is still theirs to reach');
});

test('a negative or absent mark reaches back to the start and no further', () => {
  const r = row({ position_ms: 149_000 });
  const scene = sceneSince(r, -5_000);
  assert.equal(scene.cues[0].text, 'Way back at the start.');
  assert.ok(!scene.cues.some((c) => c.text.includes('TWIST')));
});

test('a gap larger than the old five-minute cap is honoured in full', () => {
  // sceneAt tops out at MAX_LOOKBACK_MS. A catch-up must not, or a long silence
  // of the owner's silently loses its middle — which is the whole fault this fixes.
  const r = row({ position_ms: 400_000 });
  const scene = sceneSince(r, 0);
  assert.ok(scene.lookbackMs > MAX_LOOKBACK_MS, 'the window is allowed to exceed the live cap');
  assert.equal(scene.cues.length, 5, 'every cue the owner has watched, none they have not');
});
