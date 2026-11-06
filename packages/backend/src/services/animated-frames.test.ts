// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A moving picture reaches us as one sheet of its frames, one for one, and a
// still picture or a broken one goes through untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { pickFrames, columnsFor, framesSheet, openAnimatedFrames } from './animated-frames.js';
import type { ImageBlock } from './visual-blocks.js';

const W = 40;
const H = 30;

/** An animated GIF of n frames, frame f filled with its own red level. */
async function movingGif(n: number): Promise<Buffer> {
  const raw = Buffer.alloc(W * H * n * 4);
  for (let f = 0; f < n; f++) {
    for (let i = 0; i < W * H; i++) {
      const o = (f * W * H + i) * 4;
      raw[o] = f * 30;
      raw[o + 1] = 255 - f * 30;
      raw[o + 3] = 255;
    }
  }
  return sharp(raw, { raw: { width: W, height: H * n, channels: 4, pageHeight: H } }).gif().toBuffer();
}

function block(bytes: Buffer, type: ImageBlock['source']['media_type']): ImageBlock {
  return { type: 'image', source: { type: 'base64', media_type: type, data: bytes.toString('base64') } };
}

test('frames are spread evenly, first and last included, never more than six', () => {
  assert.deepEqual(pickFrames(1), []);
  assert.deepEqual(pickFrames(2), [0, 1]);
  assert.deepEqual(pickFrames(4), [0, 1, 2, 3]);
  assert.deepEqual(pickFrames(11), [0, 2, 4, 6, 8, 10]);
  assert.equal(pickFrames(300).length, 6);
  assert.equal(pickFrames(300).at(-1), 299);
  assert.equal(columnsFor(4), 4);
  assert.equal(columnsFor(6), 3);
});

test('a moving GIF becomes one sheet holding its frames in order', async () => {
  const gif = await movingGif(8);
  assert.equal((await sharp(gif, { animated: true }).metadata()).pages, 8, 'the fixture really moves');
  const sheet = await framesSheet(gif);
  assert.ok(sheet, 'a sheet came back');
  const meta = await sharp(sheet!).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 3 * W + 2 * 6, 'three across');
  assert.equal(meta.height, 2 * H + 6, 'two rows');
  // The first cell is the first frame and the last cell the last: their reds differ.
  const first = await sharp(sheet!).extract({ left: 5, top: 5, width: 1, height: 1 }).raw().toBuffer();
  const last = await sharp(sheet!).extract({ left: 2 * (W + 6) + 5, top: H + 6 + 5, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(first[0] < 20 && last[0] > 180, `first red ${first[0]}, last red ${last[0]}`);
});

test('a turn keeps its count: the moving one is swapped, the still one and a broken one pass through', async () => {
  const still = await sharp({ create: { width: W, height: H, channels: 4, background: '#ff8800' } }).png().toBuffer();
  const moving = block(await movingGif(5), 'image/gif');
  const stillPng = block(still, 'image/png');
  const broken = block(Buffer.from('not a gif at all'), 'image/gif');
  const out = await openAnimatedFrames([stillPng, moving, broken]);
  assert.equal(out.length, 3);
  assert.equal(out[0], stillPng);
  assert.equal(out[1].source.media_type, 'image/webp');
  assert.equal(out[2], broken, 'a picture sharp cannot open goes through as it came');
});

test('a single-frame GIF is left alone', async () => {
  const one = block(await movingGif(1), 'image/gif');
  const [out] = await openAnimatedFrames([one]);
  assert.equal(out, one);
});
