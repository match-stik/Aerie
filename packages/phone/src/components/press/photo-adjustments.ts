// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type {
  PhotoAdjustmentStackV1,
  PhotoAdjustmentType,
  PhotoAdjustmentV1,
} from './types';

export interface PhotoAdjustmentSpec {
  type: PhotoAdjustmentType;
  label: string;
  shortLabel: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  group: 'light' | 'color' | 'look';
}

export const PHOTO_ADJUSTMENT_SPECS: readonly PhotoAdjustmentSpec[] = [
  { type: 'exposure', label: 'Exposure', shortLabel: 'Exposure', min: -200, max: 200, step: 1, defaultValue: 0, group: 'light' },
  { type: 'contrast', label: 'Contrast', shortLabel: 'Contrast', min: -100, max: 100, step: 1, defaultValue: 0, group: 'light' },
  { type: 'temperature', label: 'Temperature', shortLabel: 'Warmth', min: -100, max: 100, step: 1, defaultValue: 0, group: 'color' },
  { type: 'tint', label: 'Tint', shortLabel: 'Tint', min: -100, max: 100, step: 1, defaultValue: 0, group: 'color' },
  { type: 'saturation', label: 'Saturation', shortLabel: 'Saturation', min: -100, max: 100, step: 1, defaultValue: 0, group: 'color' },
  { type: 'vibrance', label: 'Vibrance', shortLabel: 'Vibrance', min: -100, max: 100, step: 1, defaultValue: 0, group: 'color' },
  { type: 'black-white', label: 'Black & White', shortLabel: 'B&W', min: 0, max: 100, step: 1, defaultValue: 0, group: 'look' },
] as const;

const SPECS_BY_TYPE = Object.fromEntries(
  PHOTO_ADJUSTMENT_SPECS.map((spec) => [spec.type, spec]),
) as Record<PhotoAdjustmentType, PhotoAdjustmentSpec>;

export const EMPTY_PHOTO_ADJUSTMENTS: PhotoAdjustmentStackV1 = { version: 1, items: [] };

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizePhotoAdjustments(value: unknown): PhotoAdjustmentStackV1 {
  if (!value || typeof value !== 'object') return { ...EMPTY_PHOTO_ADJUSTMENTS, items: [] };
  const candidate = value as { version?: unknown; items?: unknown };
  if (candidate.version !== 1 || !Array.isArray(candidate.items)) return { ...EMPTY_PHOTO_ADJUSTMENTS, items: [] };
  const seen = new Set<PhotoAdjustmentType>();
  const items: PhotoAdjustmentV1[] = [];
  candidate.items.forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;
    const item = raw as Partial<PhotoAdjustmentV1>;
    if (typeof item.type !== 'string' || !(item.type in SPECS_BY_TYPE)) return;
    const type = item.type as PhotoAdjustmentType;
    if (seen.has(type)) return;
    const spec = SPECS_BY_TYPE[type];
    const normalized = clamp(finiteNumber(item.value, spec.defaultValue), spec.min, spec.max);
    if (normalized === spec.defaultValue) return;
    seen.add(type);
    items.push({
      id: typeof item.id === 'string' && item.id ? item.id : `photo-${type}`,
      type,
      enabled: item.enabled !== false,
      value: normalized,
    });
  });
  return { version: 1, items };
}

export function photoAdjustmentValue(stack: PhotoAdjustmentStackV1 | undefined, type: PhotoAdjustmentType): number {
  const spec = SPECS_BY_TYPE[type];
  const item = normalizePhotoAdjustments(stack).items.find((candidate) => candidate.type === type && candidate.enabled);
  return item?.value ?? spec.defaultValue;
}

export function setPhotoAdjustmentValue(
  stack: PhotoAdjustmentStackV1 | undefined,
  type: PhotoAdjustmentType,
  value: number,
): PhotoAdjustmentStackV1 {
  const normalized = normalizePhotoAdjustments(stack);
  const spec = SPECS_BY_TYPE[type];
  const nextValue = clamp(finiteNumber(value, spec.defaultValue), spec.min, spec.max);
  const next = normalized.items.filter((item) => item.type !== type);
  if (nextValue !== spec.defaultValue) {
    const replacement: PhotoAdjustmentV1 = {
      id: normalized.items.find((item) => item.type === type)?.id || `photo-${type}`,
      type,
      enabled: true,
      value: nextValue,
    };
    const typeOrder = PHOTO_ADJUSTMENT_SPECS.findIndex((item) => item.type === type);
    const insertion = next.findIndex((item) => PHOTO_ADJUSTMENT_SPECS.findIndex((specItem) => specItem.type === item.type) > typeOrder);
    if (insertion === -1) next.push(replacement);
    else next.splice(insertion, 0, replacement);
  }
  return { version: 1, items: next };
}

export function photoAdjustmentsHaveChanges(stack: PhotoAdjustmentStackV1 | undefined): boolean {
  return normalizePhotoAdjustments(stack).items.some((item) => item.enabled);
}

export function photoAdjustmentsEqual(
  left: PhotoAdjustmentStackV1 | undefined,
  right: PhotoAdjustmentStackV1 | undefined,
): boolean {
  return JSON.stringify(normalizePhotoAdjustments(left)) === JSON.stringify(normalizePhotoAdjustments(right));
}

function clampByte(value: number): number {
  return value <= 0 ? 0 : value >= 255 ? 255 : value;
}

function luma(red: number, green: number, blue: number): number {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

/**
 * Apply the Press adjustment recipe in place.
 *
 * The exposure operation follows Graphite's Exposure raster node ordering
 * (gain by stops, then offset/gamma in its fuller form), translated and
 * substantially modified for the compact Press control. Upstream snapshot:
 * GraphiteEditor/Graphite a770448, adjustments.rs, Apache-2.0.
 * The remaining v1 operations are Press-native implementations.
 */
export function applyPhotoAdjustments(
  pixels: Uint8ClampedArray,
  stack: PhotoAdjustmentStackV1 | undefined,
): void {
  const normalized = normalizePhotoAdjustments(stack);
  for (const adjustment of normalized.items) {
    if (!adjustment.enabled) continue;
    const amount = adjustment.value;
    for (let index = 0; index < pixels.length; index += 4) {
      let red = pixels[index];
      let green = pixels[index + 1];
      let blue = pixels[index + 2];

      switch (adjustment.type) {
        case 'exposure': {
          const gain = 2 ** (amount / 100);
          red *= gain;
          green *= gain;
          blue *= gain;
          break;
        }
        case 'contrast': {
          const factor = amount >= 0
            ? 1 + (amount / 100) * 1.65
            : 1 + amount / 100;
          red = (red - 127.5) * factor + 127.5;
          green = (green - 127.5) * factor + 127.5;
          blue = (blue - 127.5) * factor + 127.5;
          break;
        }
        case 'temperature': {
          const warmth = amount / 100;
          red += 36 * warmth;
          green += 7 * warmth;
          blue -= 36 * warmth;
          break;
        }
        case 'tint': {
          const tint = amount / 100;
          red += 15 * tint;
          green -= 30 * tint;
          blue += 15 * tint;
          break;
        }
        case 'saturation': {
          const gray = luma(red, green, blue);
          const factor = amount >= 0 ? 1 + (amount / 100) * 1.5 : 1 + amount / 100;
          red = gray + (red - gray) * factor;
          green = gray + (green - gray) * factor;
          blue = gray + (blue - gray) * factor;
          break;
        }
        case 'vibrance': {
          const maximum = Math.max(red, green, blue);
          const minimum = Math.min(red, green, blue);
          const chroma = maximum <= 0 ? 0 : (maximum - minimum) / maximum;
          const gray = luma(red, green, blue);
          const factor = amount >= 0
            ? 1 + (amount / 100) * (1 - chroma) * 1.8
            : 1 + (amount / 100) * (0.45 + chroma * 0.55);
          red = gray + (red - gray) * factor;
          green = gray + (green - gray) * factor;
          blue = gray + (blue - gray) * factor;
          break;
        }
        case 'black-white': {
          const gray = luma(red, green, blue);
          const mix = amount / 100;
          red += (gray - red) * mix;
          green += (gray - green) * mix;
          blue += (gray - blue) * mix;
          break;
        }
      }

      pixels[index] = clampByte(red);
      pixels[index + 1] = clampByte(green);
      pixels[index + 2] = clampByte(blue);
      // Alpha is intentionally untouched so imported transparency and Press
      // edge masks survive every adjustment.
    }
  }
}

export const PHOTO_LOOK_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  note: string;
  stack: PhotoAdjustmentStackV1;
}> = [
  {
    id: 'warm-print',
    label: 'Warm print',
    note: 'Sun-warmed paper',
    stack: normalizePhotoAdjustments({ version: 1, items: [
      { id: 'photo-exposure', type: 'exposure', enabled: true, value: 12 },
      { id: 'photo-contrast', type: 'contrast', enabled: true, value: 10 },
      { id: 'photo-temperature', type: 'temperature', enabled: true, value: 24 },
      { id: 'photo-vibrance', type: 'vibrance', enabled: true, value: 12 },
    ] }),
  },
  {
    id: 'faded-page',
    label: 'Faded page',
    note: 'Soft old-paper wash',
    stack: normalizePhotoAdjustments({ version: 1, items: [
      { id: 'photo-exposure', type: 'exposure', enabled: true, value: 16 },
      { id: 'photo-contrast', type: 'contrast', enabled: true, value: -18 },
      { id: 'photo-temperature', type: 'temperature', enabled: true, value: 18 },
      { id: 'photo-saturation', type: 'saturation', enabled: true, value: -24 },
    ] }),
  },
  {
    id: 'night-ink',
    label: 'Night ink',
    note: 'Cool, dense shadows',
    stack: normalizePhotoAdjustments({ version: 1, items: [
      { id: 'photo-exposure', type: 'exposure', enabled: true, value: -18 },
      { id: 'photo-contrast', type: 'contrast', enabled: true, value: 30 },
      { id: 'photo-temperature', type: 'temperature', enabled: true, value: -16 },
      { id: 'photo-vibrance', type: 'vibrance', enabled: true, value: 18 },
    ] }),
  },
  {
    id: 'silver-gelatin',
    label: 'Silver',
    note: 'Hard monochrome',
    stack: normalizePhotoAdjustments({ version: 1, items: [
      { id: 'photo-contrast', type: 'contrast', enabled: true, value: 24 },
      { id: 'photo-black-white', type: 'black-white', enabled: true, value: 100 },
    ] }),
  },
];
