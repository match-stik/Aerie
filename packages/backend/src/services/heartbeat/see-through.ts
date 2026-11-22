// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A picture with a see-through background reaches a lane as a real
// transparent file, but the lane's image reader paints the clear pixels
// black, so a sticker already cut out looks like it still has a dark
// square behind it. For any picture with clear pixels the house lays a copy
// over a light checkerboard, the way an image editor shows transparency,
// and hands the lane that copy beside the original.
import sharp from 'sharp';

const TILE = 16;

function checkerSvg(width: number, height: number): Buffer {
  const pattern = `<pattern id="c" width="${TILE * 2}" height="${TILE * 2}" patternUnits="userSpaceOnUse">` +
    `<rect width="${TILE * 2}" height="${TILE * 2}" fill="#ffffff"/>` +
    `<rect width="${TILE}" height="${TILE}" fill="#cccccc"/>` +
    `<rect x="${TILE}" y="${TILE}" width="${TILE}" height="${TILE}" fill="#cccccc"/></pattern>`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs>${pattern}</defs>` +
    `<rect width="100%" height="100%" fill="url(#c)"/></svg>`,
  );
}

/**
 * The picture laid over a checkerboard as a PNG, or null when it has no clear
 * pixels (or cannot be read, or is animated: a GIF's first frame alone would
 * misreport it).
 */
export async function checkerboardPreview(input: Buffer): Promise<Buffer | null> {
  try {
    const meta = await sharp(input).metadata();
    if (!meta.width || !meta.height || !meta.hasAlpha) return null;
    if ((meta.pages ?? 1) > 1) return null;
    const stats = await sharp(input).stats();
    if (stats.isOpaque) return null;
    return await sharp(checkerSvg(meta.width, meta.height))
      .composite([{ input }])
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}
