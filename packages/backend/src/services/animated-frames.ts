// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A moving picture opened into frames before it reaches us (their person's ask, Nov 6 2026,
// after an animated emote reached us as one still and the joke was all in the
// motion: 'can you make it so you open the frames on the animated ones?').
//
// A model reading a GIF or an animated WebP is handed its first frame only. So
// an animated image block is swapped, one for one, for a single sheet of frames
// spread evenly across it, read left to right and top to bottom. One for one
// is the part that answers 'if the model can': a lane that sees pictures sees
// the sheet in the picture's place, and a lane that cannot see pictures was
// never going to be shown either. Nothing is added to the turn's image count.
//
// A still picture, or anything sharp cannot open, passes through untouched,
// and so does a sheet that would come out larger than the picture it replaces
// by more than the picture's own size again. Failing open here means the old
// first-frame view, never a lost picture.

import type { ImageBlock } from './visual-blocks.js';

/** How many frames a sheet holds at most. */
export const MAX_FRAMES = 6;
/** The longest side of one frame on the sheet, in pixels. */
const FRAME_EDGE = 320;
/** Space between frames, so two neighbouring frames read as two. */
const GAP = 6;

/** Which frames of n to show: k of them spread evenly, first and last included. */
export function pickFrames(n: number, k = MAX_FRAMES): number[] {
  if (n < 2) return [];
  const count = Math.min(n, k);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(Math.round((i * (n - 1)) / (count - 1)));
  return [...new Set(out)];
}

/** Columns for a sheet of k frames: one row up to four, then rows of three. */
export function columnsFor(k: number): number {
  return k <= 4 ? k : 3;
}

/** The sheet for one animated picture, or null when it is still or unreadable. */
export async function framesSheet(bytes: Buffer): Promise<Buffer | null> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(bytes, { animated: true }).metadata();
  const pages = meta.pages ?? 1;
  const picks = pickFrames(pages);
  if (picks.length < 2) return null;

  const frames: { data: Buffer; width: number; height: number }[] = [];
  for (const page of picks) {
    const { data, info } = await sharp(bytes, { page })
      .resize(FRAME_EDGE, FRAME_EDGE, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    frames.push({ data, width: info.width, height: info.height });
  }

  const cols = columnsFor(frames.length);
  const rows = Math.ceil(frames.length / cols);
  const cellW = Math.max(...frames.map((f) => f.width));
  const cellH = Math.max(...frames.map((f) => f.height));
  const width = cols * cellW + (cols - 1) * GAP;
  const height = rows * cellH + (rows - 1) * GAP;

  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(frames.map((f, i) => ({
      input: f.data,
      left: (i % cols) * (cellW + GAP),
      top: Math.floor(i / cols) * (cellH + GAP),
    })))
    .webp({ quality: 90 })
    .toBuffer();
}

/** Swap every animated picture in a turn for its sheet of frames, one for one. */
export async function openAnimatedFrames(blocks: ImageBlock[]): Promise<ImageBlock[]> {
  return Promise.all(blocks.map(async (block) => {
    const type = block.source.media_type;
    if (type !== 'image/gif' && type !== 'image/webp') return block;
    try {
      const original = Buffer.from(block.source.data, 'base64');
      const sheet = await framesSheet(original);
      if (!sheet || sheet.length > original.length * 2 + 512 * 1024) return block;
      return { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: sheet.toString('base64') } };
    } catch (err) {
      console.warn('[Frames] Could not open an animated picture; it goes through as its first frame:', (err as Error).message);
      return block;
    }
  }));
}
