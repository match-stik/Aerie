// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mp3LeadLength } from './mp3-lead.js';

// MPEG-1 Layer III, 128 kbps, 44.1 kHz, no padding: 417-byte frames.
function frame(fill = 0x00, tag = ''): Buffer {
  const buf = Buffer.alloc(417, fill);
  buf[0] = 0xff; buf[1] = 0xfb; buf[2] = 0x90; buf[3] = 0x64;
  if (tag) buf.write(tag, 36, 'latin1');
  return buf;
}

function id3(bodyLength: number): Buffer {
  const head = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
  head[9] = bodyLength & 0x7f;
  head[8] = (bodyLength >> 7) & 0x7f;
  return Buffer.concat([head, Buffer.alloc(bodyLength)]);
}

test('a plain audio frame has no lead', () => {
  assert.equal(mp3LeadLength(Buffer.concat([frame(0x11), frame(0x22)])), 0);
});

test('an ID3 tag and an Info frame are both lead', () => {
  const tag = id3(200);
  const buf = Buffer.concat([tag, frame(0, 'Info'), frame(0x33)]);
  assert.equal(mp3LeadLength(buf), tag.length + 417);
});

test('a Xing frame without a tag is lead', () => {
  assert.equal(mp3LeadLength(Buffer.concat([frame(0, 'Xing'), frame(0x44)])), 417);
});

test('too few bytes to tell asks for more', () => {
  assert.equal(mp3LeadLength(Buffer.from([0x49, 0x44, 0x33])), null);
  assert.equal(mp3LeadLength(id3(300).subarray(0, 100)), null);
});

test('bytes that are not a frame pass through untouched', () => {
  assert.equal(mp3LeadLength(Buffer.alloc(64, 0x00)), 0);
});
