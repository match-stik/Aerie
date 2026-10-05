// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSubtitles, subtitleDurationMs } from './subtitles.js';

const SRT = `1
00:00:01,000 --> 00:00:04,000
Yes, chef.

2
00:00:05,500 --> 00:00:07,250
<i>Behind!</i>
Corner.

3
00:01:02,00 --> 00:01:04,00
{\\an8}Two-digit fraction.
`;

const VTT = `WEBVTT

NOTE this block is not a cue and must be skipped

STYLE
::cue { color: yellow }

intro
00:00:02.000 --> 00:00:03.000
<c.yellow>First.</c>

00:00:09.000 --> 00:00:10.000
Second.
`;

test('SRT parses into cues in order', () => {
  const cues = parseSubtitles(SRT);
  assert.equal(cues.length, 3);
  assert.deepEqual(cues[0], { index: 1, startMs: 1000, endMs: 4000, text: 'Yes, chef.' });
});

test('markup is stripped and wrapped lines join into one string', () => {
  const cues = parseSubtitles(SRT);
  assert.equal(cues[1].text, 'Behind! Corner.');
  assert.equal(cues[2].text, 'Two-digit fraction.');
});

test('a two-digit fraction is hundredths, not milliseconds', () => {
  // 00:01:02,00 is 62.00 seconds. Read naively it becomes 62.000 + 0ms, which
  // happens to be right — so test the case that actually breaks: ,5
  const cues = parseSubtitles('1\n00:00:01,5 --> 00:00:02,5\nHalf a second in.\n');
  assert.equal(cues[0].startMs, 1500);
  assert.equal(cues[0].endMs, 2500);
});

test('VTT header, NOTE and STYLE blocks are skipped and cue ids ignored', () => {
  const cues = parseSubtitles(VTT);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues.map((c) => c.text), ['First.', 'Second.']);
  assert.equal(cues[0].startMs, 2000);
});

test('a malformed block costs that cue and not the episode', () => {
  const cues = parseSubtitles('1\nnot a timestamp at all\nlost\n\n2\n00:00:08,000 --> 00:00:09,000\nkept\n');
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, 'kept');
});

test('an end before its start is dropped rather than inverting the window', () => {
  const cues = parseSubtitles('1\n00:00:09,000 --> 00:00:02,000\nbackwards\n');
  assert.equal(cues.length, 0);
});

test('out-of-order files are sorted and re-indexed', () => {
  const cues = parseSubtitles(
    '1\n00:00:09,000 --> 00:00:10,000\nlater\n\n2\n00:00:01,000 --> 00:00:02,000\nearlier\n',
  );
  assert.deepEqual(cues.map((c) => c.text), ['earlier', 'later']);
  assert.deepEqual(cues.map((c) => c.index), [1, 2]);
});

test('CRLF and a byte order mark do not stop it parsing', () => {
  const cues = parseSubtitles('﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nfine\r\n');
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, 'fine');
});

test('duration is the last end, and an empty list is zero', () => {
  assert.equal(subtitleDurationMs(parseSubtitles(SRT)), 64000);
  assert.equal(subtitleDurationMs([]), 0);
});
