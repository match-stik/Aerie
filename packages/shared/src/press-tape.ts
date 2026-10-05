// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * The Press tape strip — one definition, both doors.
 *
 * A strip of tape in the Press is a RECIPE rather than baked pixels: a preset,
 * a colour and a seed, from which the exact same SVG can be rebuilt on demand.
 * That generator is pure string work — no canvas, no DOM, nothing that needs a
 * browser — but it lived in packages/phone, so the only hand that could reach
 * it was the owner's on the editor screen. A companion composing a spread from a lane
 * could place photographs and could not put one piece of tape on top of them,
 * which is why every page this house has made programmatically is flat.
 *
 * Same shape as the note roles: the value has to be canonical somewhere both
 * doors can import, or the second door quietly grows its own copy and the two
 * drift. Nothing here may reach for `document`, `btoa` or `Buffer` — it has to
 * run identically in the phone and in a lane.
 */

export const TAPE_PRESET_IDS = ['masking', 'vellum', 'paper', 'repair'] as const;
export type TapePresetId = (typeof TAPE_PRESET_IDS)[number];

export interface TapePreset {
  id: TapePresetId;
  label: string;
  color: string;
  note: string;
}

export const TAPE_PRESETS: TapePreset[] = [
  { id: 'masking', label: 'Masking', color: '#d7b77d', note: 'Cloudy + creased' },
  { id: 'vellum', label: 'Vellum', color: '#f2dfb5', note: 'Translucent' },
  { id: 'paper', label: 'Paper', color: '#d68b69', note: 'Fibrous + matte' },
  { id: 'repair', label: 'Repair', color: '#24211f', note: 'Glossy black' },
];

/** A tape strip as it is stored on the element, and as a lane would hand it over. */
export interface TapeMaterialRecipe {
  kind: 'tape';
  preset: TapePresetId;
  color: string;
  seed: number;
}

export function isTapePreset(value: unknown): value is TapePresetId {
  return typeof value === 'string' && (TAPE_PRESET_IDS as readonly string[]).includes(value);
}

/** Shared with the phone's edge masking, so the two cannot disagree about randomness. */
export function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let out = value;
    out = Math.imul(out ^ (out >>> 15), out | 1);
    out ^= out + Math.imul(out ^ (out >>> 7), out | 61);
    return ((out ^ (out >>> 14)) >>> 0) / 4294967296;
  };
}

const TAPE_PROFILES: Record<TapePresetId, { baseOpacity: number; grain: number; shine: number }> = {
  masking: { baseOpacity: 0.82, grain: 0.38, shine: 0.18 },
  vellum: { baseOpacity: 0.56, grain: 0.18, shine: 0.24 },
  paper: { baseOpacity: 0.94, grain: 0.48, shine: 0.08 },
  repair: { baseOpacity: 0.98, grain: 0.2, shine: 0.5 },
};

function escapeColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#d7b77d';
}

/** The torn long edges. Same seed, same rip, forever. */
export function tapePath(seed: number): string {
  const rand = mulberry32(seed);
  const left = Array.from({ length: 7 }, (_, index) => `${(rand() * 5).toFixed(1)},${(index * 16.66).toFixed(1)}`);
  const right = Array.from({ length: 7 }, (_, index) => `${(300 - rand() * 5).toFixed(1)},${(100 - index * 16.66).toFixed(1)}`);
  return `M ${left.join(' L ')} L ${right.join(' L ')} Z`;
}

/** The strip itself, as SVG source. A lane can write this straight to a file. */
export function tapeSvg(preset: TapePresetId, color: string, seed: number): string {
  const safeColor = escapeColor(color);
  const profile = TAPE_PROFILES[preset];
  const path = tapePath(seed);
  return `
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
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64 by hand, because the two runtimes disagree about who owns the job.
 * `btoa` is a browser global that Node deprecates, `Buffer` is a Node global
 * that drags a polyfill into the phone bundle, and this file has to be the
 * same file in both places.
 */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    out += BASE64_ALPHABET[a >> 2];
    out += BASE64_ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : BASE64_ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : BASE64_ALPHABET[c & 63];
  }
  return out;
}

/** The strip as an inline data URL, which is what an Excalidraw file entry wants. */
export function createTapeDataURL(preset: TapePresetId, color: string, seed: number): string {
  const bytes = new TextEncoder().encode(tapeSvg(preset, color, seed));
  return `data:image/svg+xml;base64,${toBase64(bytes)}`;
}

/** The default colour for a preset. Repair tape is black on purpose and does not take a tint. */
export function tapeColorFor(preset: TapePresetId, requested?: string | null): string {
  const definition = TAPE_PRESETS.find((item) => item.id === preset);
  const fallback = definition?.color ?? '#d7b77d';
  if (preset === 'repair') return fallback;
  return requested && /^#[0-9a-f]{6}$/i.test(requested) ? requested : fallback;
}

/**
 * Everything a caller needs to put one strip on a page: the recipe to store on
 * the element, and the data URL to register as its file. Deliberately does NOT
 * build the Excalidraw element — placement is the composer's call, and the
 * phone and a lane place things differently.
 */
export function tapeMaterial(
  preset: TapePresetId,
  options: { color?: string | null; seed: number },
): { recipe: TapeMaterialRecipe; dataURL: string; mimeType: 'image/svg+xml' } {
  const color = tapeColorFor(preset, options.color);
  return {
    recipe: { kind: 'tape', preset, color, seed: options.seed },
    dataURL: createTapeDataURL(preset, color, options.seed),
    mimeType: 'image/svg+xml',
  };
}
