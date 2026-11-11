// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { FRAME_COUNT, MAX_FRAMES, framesFor, plainError, tooLong, videoUrl } from './video-room.js';

test('only web links are taken', () => {
  assert.equal(videoUrl('https://www.tiktok.com/t/abc/'), 'https://www.tiktok.com/t/abc/');
  assert.equal(videoUrl('  https://youtu.be/xyz  '), 'https://youtu.be/xyz');
  assert.equal(videoUrl('file:///etc/passwd'), null);
  assert.equal(videoUrl('--exec rm'), null);
  assert.equal(videoUrl(42), null);
});

test('a failed fetch is said plainly, never as the command that failed', () => {
  const youtube = Object.assign(new Error('Command failed: yt-dlp --no-warnings https://x'), {
    stderr: '[youtube] x: Downloading webpage\nERROR: [youtube] YE7VzlLtp-4: Sign in to confirm you’re not a bot. Use --cookies',
  });
  assert.match(plainError(youtube), /YouTube wants a signed-in browser/);
  const other = Object.assign(new Error('Command failed: yt-dlp'), { stderr: 'ERROR: [generic] Unsupported URL: https://example.com' });
  assert.equal(plainError(other), 'Unsupported URL: https://example.com');
  assert.doesNotMatch(plainError(new Error('Command failed: yt-dlp\nsomething broke')), /Command failed/);
});

test('a longer video gets more looks, one every five seconds, between eight and thirty', () => {
  assert.equal(framesFor(30), FRAME_COUNT, 'a TikTok keeps its eight');
  assert.equal(framesFor(null), FRAME_COUNT, 'an unknown length gets the eight');
  assert.equal(framesFor(90), 18);
  assert.equal(framesFor(540), MAX_FRAMES, 'nine minutes is capped, not buried');
});

test('past the limit a video is turned away in one plain line, and at it or under it is not', () => {
  assert.equal(tooLong(600, 600), null);
  assert.equal(tooLong(30, 600), null);
  assert.equal(tooLong(null, 600), null, 'a length nobody knows is fetched and measured after');
  const line = tooLong(25 * 60, 600) ?? '';
  assert.match(line, /^it runs 25 minutes and the Video Room takes up to 10 minutes/);
  assert.doesNotMatch(line, /\.$/, 'it is read after a colon and before the room\'s own full stop');
});
