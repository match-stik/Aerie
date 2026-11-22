// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { checkerboardPreview } from './see-through.js';

test('a picture with clear pixels gets a checkerboard copy, light where it was clear', async () => {
  // A red dot in the middle of a fully clear square.
  const clear = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(), top: 24, left: 24 }])
    .png().toBuffer();
  const out = await checkerboardPreview(clear);
  assert.ok(out, 'a transparent picture gets a preview');
  const { data, info } = await sharp(out!).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 64);
  const px = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
  // The corner was clear: it must now read light (checker), never black.
  assert.ok(px(0, 0).every((v) => v >= 200), `corner reads light, got ${px(0, 0)}`);
  // The dot is untouched.
  assert.deepEqual(px(32, 32), [255, 0, 0]);
});

test('an opaque picture gets no copy', async () => {
  const solid = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer();
  assert.equal(await checkerboardPreview(solid), null);
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer();
  assert.equal(await checkerboardPreview(jpeg), null);
});

test('something that is not a picture gets no copy and does not throw', async () => {
  assert.equal(await checkerboardPreview(Buffer.from('not an image')), null);
});
