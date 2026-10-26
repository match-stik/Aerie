// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Which emoji this phone can actually draw.
//
// The trays carry every emoji Unicode has published, and a phone's emoji font
// is usually a version or two behind. An emoji the font lacks draws as an
// empty box, and a newer combined one (a goose, a phoenix, a face in clouds)
// falls apart into the pieces it is made of, side by side. Either way it is
// no use to the owner, so the trays leave it out and it turns up by itself once the
// phone's font learns it.
//
// The test draws each emoji once on a small canvas: nothing painted, the same
// picture as a character no font has, or wider than one emoji means it can't
// be drawn. Answers are kept per browser version, so a WebView update (which
// is how a new emoji font usually arrives) asks again. Anything that cannot be
// measured counts as drawable: a full tray beats an empty one.
import { EMOJI_DATA_VERSION } from './emoji';

const SIZE = 32;
const W = SIZE * 3;
const H = Math.round(SIZE * 1.5);
const STORE_KEY = 'aerie.emoji-drawable';

interface Snapshot { width: number; pixels: Uint8ClampedArray }

let ctx: CanvasRenderingContext2D | null | undefined;
let reference: Snapshot | null = null;
let notdef: Snapshot | null = null;
let answers: Record<string, 0 | 1> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function storeTag(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return `${EMOJI_DATA_VERSION}|${ua}`;
}

function loadAnswers(): Record<string, 0 | 1> {
  if (answers) return answers;
  answers = {};
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { tag?: string; r?: Record<string, 0 | 1> };
      if (parsed && parsed.tag === storeTag() && parsed.r && typeof parsed.r === 'object') answers = parsed.r;
    }
  } catch {
    /* a bad store just means asking again */
  }
  return answers;
}

function saveSoon(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ tag: storeTag(), r: answers ?? {} }));
    } catch {
      /* storage full or off: the answers still hold for this session */
    }
  }, 500);
}

function context(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  ctx = null;
  try {
    if (typeof document === 'undefined') return ctx;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const c = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
    if (!c) return ctx;
    c.font = `${SIZE}px sans-serif`;
    c.textBaseline = 'top';
    c.fillStyle = '#000';
    ctx = c;
    reference = snapshot('😀');
    // A private-use character in the last plane: no font has it, so this is
    // what "can't draw" looks like on this phone.
    notdef = snapshot(String.fromCodePoint(0x10fffd));
    if (!reference || !(reference.width > 0)) ctx = null;
    // No emoji font at all: the smiley itself comes out as the empty box, so
    // nothing here can be told apart. Show everything rather than nothing.
    else if (notdef && sameImage(reference, notdef)) ctx = null;
  } catch {
    ctx = null;
  }
  return ctx;
}

function snapshot(text: string): Snapshot | null {
  const c = ctx;
  if (!c) return null;
  c.clearRect(0, 0, W, H);
  c.fillText(text, 0, 0);
  return { width: c.measureText(text).width, pixels: c.getImageData(0, 0, W, H).data };
}

function sameImage(a: Snapshot, b: Snapshot): boolean {
  if (a.width !== b.width || a.pixels.length !== b.pixels.length) return false;
  for (let i = 0; i < a.pixels.length; i++) if (a.pixels[i] !== b.pixels[i]) return false;
  return true;
}

function measure(emoji: string): boolean {
  if (!context() || !reference) return true;
  const shot = snapshot(emoji);
  if (!shot) return true;
  // Fallen apart into its pieces, or a flag drawn as two letters.
  if (shot.width > reference.width * 1.45) return false;
  let painted = false;
  let sameAsNotdef = !!notdef && notdef.width === shot.width;
  const a = shot.pixels;
  const b = notdef?.pixels;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] !== 0) painted = true;
    if (sameAsNotdef && b && (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3])) {
      sameAsNotdef = false;
    }
    if (painted && !sameAsNotdef) break;
  }
  if (!painted) return false;
  if (sameAsNotdef) return false;
  return true;
}

/** Whether this phone draws the emoji as one picture. */
export function canDraw(emoji: string): boolean {
  const store = loadAnswers();
  const known = store[emoji];
  if (known !== undefined) return known === 1;
  let ok = true;
  try {
    ok = measure(emoji);
  } catch {
    ok = true;
  }
  store[emoji] = ok ? 1 : 0;
  saveSoon();
  return ok;
}

/** The ones from a list this phone can draw, in the same order. */
export function drawable(list: string[]): string[] {
  return list.filter(canDraw);
}
