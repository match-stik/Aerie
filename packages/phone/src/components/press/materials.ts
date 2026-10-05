// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { EdgePresetId, TapePresetId } from './types';

export const EDGE_PRESETS: Array<{ id: EdgePresetId; label: string; note: string }> = [
  { id: 'clean', label: 'Clean', note: 'Original edge' },
  { id: 'soft-tear', label: 'Soft tear', note: 'Fine paper fibers' },
  { id: 'deckled', label: 'Deckled', note: 'Wide handmade edge' },
  { id: 'ripped-corners', label: 'Ripped corners', note: 'Torn corner bites' },
  { id: 'scalloped', label: 'Scalloped', note: 'Rounded cut edge' },
];

export const TAPE_PRESETS: Array<{ id: TapePresetId; label: string; color: string; note: string }> = [
  { id: 'masking', label: 'Masking', color: '#d7b77d', note: 'Cloudy + creased' },
  { id: 'vellum', label: 'Vellum', color: '#f2dfb5', note: 'Translucent' },
  { id: 'paper', label: 'Paper', color: '#d68b69', note: 'Fibrous + matte' },
  { id: 'repair', label: 'Repair', color: '#24211f', note: 'Glossy black' },
];

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

function decodeImage(source: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode image'));
    };
    image.src = url;
  });
}

export async function readImageDimensions(source: Blob): Promise<{ width: number; height: number }> {
  const image = await decodeImage(source);
  return { width: image.naturalWidth, height: image.naturalHeight };
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
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  preset: EdgePresetId,
  seed: number,
): void {
  ctx.beginPath();

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
    points.forEach(([x, y], index) => index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
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
    points.forEach(([x, y], index) => index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  } else {
    const deckled = preset === 'deckled';
    const amplitude = Math.max(8, Math.min(width, height) * (deckled ? 0.045 : 0.022));
    const step = Math.max(7, Math.round(Math.min(width, height) * (deckled ? 0.026 : 0.014)));
    const points = edgeJitterPoints(width, height, seed, amplitude, step);
    points.forEach(([x, y], index) => index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  }

  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
}

export async function renderEdgePreview(
  source: Blob,
  preset: EdgePresetId,
  seed: number,
  maxDimension = 1500,
): Promise<{ blob: Blob; dataURL: string; width: number; height: number }> {
  const image = await decodeImage(source);
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');

  ctx.drawImage(image, 0, 0, width, height);
  if (preset !== 'clean') {
    ctx.globalCompositeOperation = 'destination-in';
    polygonMask(ctx, width, height, preset, seed);
    ctx.globalCompositeOperation = 'source-over';
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not render material')), 'image/png', 0.94);
  });
  return { blob, dataURL: canvas.toDataURL('image/png'), width, height };
}

function tapePath(seed: number): string {
  const rand = mulberry32(seed);
  const left = Array.from({ length: 7 }, (_, index) => `${(rand() * 5).toFixed(1)},${(index * 16.66).toFixed(1)}`);
  const right = Array.from({ length: 7 }, (_, index) => `${(300 - rand() * 5).toFixed(1)},${(100 - index * 16.66).toFixed(1)}`);
  return `M ${left.join(' L ')} L ${right.join(' L ')} Z`;
}

function escapeColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#d7b77d';
}

export function createTapeDataURL(preset: TapePresetId, color: string, seed: number): string {
  const safeColor = escapeColor(color);
  const profile = {
    masking: { baseOpacity: 0.82, grain: 0.38, shine: 0.18 },
    vellum: { baseOpacity: 0.56, grain: 0.18, shine: 0.24 },
    paper: { baseOpacity: 0.94, grain: 0.48, shine: 0.08 },
    repair: { baseOpacity: 0.98, grain: 0.2, shine: 0.5 },
  }[preset];
  const path = tapePath(seed);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100">
      <defs>
        <filter id="grain" x="-10%" y="-20%" width="120%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.72 0.16" numOctaves="2" seed="${seed % 97}" result="noise"/>
          <feColorMatrix in="noise" type="saturate" values="0" result="mono"/>
          <feComponentTransfer in="mono" result="softNoise">
            <feFuncA type="table" tableValues="0 ${profile.grain}"/>
          </feComponentTransfer>
          <feBlend in="SourceGraphic" in2="softNoise" mode="soft-light"/>
        </filter>
        <linearGradient id="light" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="${profile.shine}"/>
          <stop offset="0.48" stop-color="#fff" stop-opacity="0"/>
          <stop offset="1" stop-color="#111" stop-opacity="0.14"/>
        </linearGradient>
      </defs>
      <path d="${path}" fill="${safeColor}" fill-opacity="${profile.baseOpacity}" filter="url(#grain)"/>
      <path d="${path}" fill="url(#light)"/>
      <path d="M18 28 C75 20 116 37 170 26 S245 34 283 22" fill="none" stroke="#fff" stroke-opacity="0.2" stroke-width="1.5"/>
      <path d="M14 72 C80 62 119 78 188 68 S244 77 286 64" fill="none" stroke="#24180f" stroke-opacity="0.12" stroke-width="1.4"/>
    </svg>`;
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

export function nextMaterialSeed(): number {
  return Math.floor(Math.random() * 2_000_000_000) + 1;
}
