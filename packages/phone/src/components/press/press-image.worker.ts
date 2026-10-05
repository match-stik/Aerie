// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { applyPhotoAdjustments } from './photo-adjustments';
import type { EdgePresetId, PhotoAdjustmentStackV1 } from './types';

interface PressImageWorkerRequest {
  id: string;
  sourceKey: string;
  source?: Blob;
  adjustments: PhotoAdjustmentStackV1;
  edgePreset: EdgePresetId;
  seed: number;
  maxDimension: number;
  mimeType: 'image/png' | 'image/webp';
  quality: number;
}

interface CachedSource {
  key: string;
  bitmap: ImageBitmap;
}

let cachedSource: CachedSource | null = null;

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let out = value;
    out = Math.imul(out ^ (out >>> 15), out | 1);
    out ^= out + Math.imul(out ^ (out >>> 7), out | 61);
    return ((out ^ (out >>> 14)) >>> 0) / 4294967296;
  };
}

function edgeJitterPoints(
  width: number,
  height: number,
  seed: number,
  amplitude: number,
  step: number,
): Array<[number, number]> {
  const rand = mulberry32(seed);
  const points: Array<[number, number]> = [];
  for (let x = 0; x <= width; x += step) points.push([x, rand() * amplitude]);
  for (let y = 0; y <= height; y += step) points.push([width - rand() * amplitude, y]);
  for (let x = width; x >= 0; x -= step) points.push([x, height - rand() * amplitude]);
  for (let y = height; y >= 0; y -= step) points.push([rand() * amplitude, y]);
  return points;
}

function polygonMask(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  preset: EdgePresetId,
  seed: number,
): void {
  context.beginPath();
  if (preset === 'scalloped') {
    const scallop = Math.max(12, Math.round(Math.min(width, height) * 0.035));
    const points: Array<[number, number]> = [];
    for (let x = 0; x <= width; x += scallop / 2) {
      const inset = (1 + Math.sin((x / scallop) * Math.PI * 2)) * scallop * 0.22;
      points.push([x, inset]);
    }
    for (let y = 0; y <= height; y += scallop / 2) {
      const inset = (1 + Math.sin((y / scallop) * Math.PI * 2)) * scallop * 0.22;
      points.push([width - inset, y]);
    }
    for (let x = width; x >= 0; x -= scallop / 2) {
      const inset = (1 + Math.sin((x / scallop) * Math.PI * 2)) * scallop * 0.22;
      points.push([x, height - inset]);
    }
    for (let y = height; y >= 0; y -= scallop / 2) {
      const inset = (1 + Math.sin((y / scallop) * Math.PI * 2)) * scallop * 0.22;
      points.push([inset, y]);
    }
    points.forEach(([x, y], index) => index === 0 ? context.moveTo(x, y) : context.lineTo(x, y));
  } else if (preset === 'ripped-corners') {
    const rand = mulberry32(seed);
    const bite = Math.max(18, Math.min(width, height) * 0.085);
    const wobble = () => (rand() - 0.5) * bite * 0.3;
    const points: Array<[number, number]> = [
      [bite + wobble(), 0], [width - bite + wobble(), 0],
      [width - bite * 0.45, bite * 0.28], [width, bite + wobble()],
      [width, height - bite + wobble()], [width - bite * 0.35, height - bite * 0.35],
      [width - bite + wobble(), height], [bite + wobble(), height],
      [bite * 0.4, height - bite * 0.3], [0, height - bite + wobble()],
      [0, bite + wobble()], [bite * 0.35, bite * 0.3],
    ];
    points.forEach(([x, y], index) => index === 0 ? context.moveTo(x, y) : context.lineTo(x, y));
  } else {
    const deckled = preset === 'deckled';
    const amplitude = Math.max(8, Math.min(width, height) * (deckled ? 0.045 : 0.022));
    const step = Math.max(7, Math.round(Math.min(width, height) * (deckled ? 0.026 : 0.014)));
    edgeJitterPoints(width, height, seed, amplitude, step)
      .forEach(([x, y], index) => index === 0 ? context.moveTo(x, y) : context.lineTo(x, y));
  }
  context.closePath();
  context.fillStyle = '#fff';
  context.fill();
}

async function sourceBitmap(request: PressImageWorkerRequest): Promise<ImageBitmap> {
  if (cachedSource?.key === request.sourceKey) return cachedSource.bitmap;
  if (!request.source) throw new Error('The darkroom lost its source image.');
  cachedSource?.bitmap.close();
  const bitmap = await createImageBitmap(request.source, { imageOrientation: 'from-image' });
  cachedSource = { key: request.sourceKey, bitmap };
  return bitmap;
}

self.onmessage = async (event: MessageEvent<PressImageWorkerRequest>) => {
  const request = event.data;
  try {
    const bitmap = await sourceBitmap(request);
    const boundedMax = Math.max(64, request.maxDimension);
    const scale = Math.min(1, boundedMax / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('The darkroom canvas is unavailable.');
    context.drawImage(bitmap, 0, 0, width, height);
    if (request.adjustments.items.length) {
      const image = context.getImageData(0, 0, width, height);
      applyPhotoAdjustments(image.data, request.adjustments);
      context.putImageData(image, 0, 0);
    }
    if (request.edgePreset !== 'clean') {
      context.globalCompositeOperation = 'destination-in';
      polygonMask(context, width, height, request.edgePreset, request.seed);
      context.globalCompositeOperation = 'source-over';
    }
    const blob = await canvas.convertToBlob({
      type: request.mimeType,
      quality: request.quality,
    });
    self.postMessage({ id: request.id, ok: true, blob, width, height, mimeType: blob.type });
  } catch (error) {
    self.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : 'The darkroom could not render that photo.',
    });
  }
};
