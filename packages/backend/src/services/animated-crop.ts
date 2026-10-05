// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Cut the same square out of every frame of a picture, keeping its timing and its
 * loop, and size it for a pack. The phone crops a still on a canvas, but a canvas
 * keeps one frame, so an animated sticker or emoji is framed on the phone and cut
 * here. sharp loads lazily, so a broken sharp costs the crop and not the route
 * that asked for it.
 */
export interface CropBox { x: number; y: number; width: number; height: number }

export async function cropEveryFrame(
  src: Buffer,
  box: CropBox,
  size: number,
): Promise<{ out: Buffer; mime: 'image/gif' | 'image/webp' }> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(src, { animated: true }).metadata();
  const fullW = meta.width ?? 0;
  const fullH = meta.pageHeight ?? meta.height ?? 0;
  // The phone keeps the box inside the picture for animated ones; this is the guard.
  const left = Math.max(0, Math.min(fullW - 1, Math.round(box.x)));
  const top = Math.max(0, Math.min(fullH - 1, Math.round(box.y)));
  const width = Math.max(1, Math.min(fullW - left, Math.round(box.width)));
  const height = Math.max(1, Math.min(fullH - top, Math.round(box.height)));
  const pipeline = sharp(src, { animated: true })
    .extract({ left, top, width, height })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
  const isGif = meta.format === 'gif';
  // interFrameMaxError lets unchanged pixels carry over between frames, which is
  // what keeps a cropped GIF near its original weight instead of doubling it.
  const out = isGif
    ? await pipeline.gif({ interFrameMaxError: 8, interPaletteMaxError: 8, effort: 8 }).toBuffer()
    : await pipeline.webp({ quality: 90, effort: 5 }).toBuffer();
  return { out, mime: isGif ? 'image/gif' : 'image/webp' };
}

/** A crop box sent alongside an upload. Absent or partial means no crop at all. */
export function cropBoxFrom(body: any): CropBox | null {
  const nums = ['cropX', 'cropY', 'cropWidth', 'cropHeight'].map((k) => Number(body?.[k]));
  if (nums.some((n) => !Number.isFinite(n)) || nums[2] < 1 || nums[3] < 1) return null;
  return { x: nums[0], y: nums[1], width: nums[2], height: nums[3] };
}
