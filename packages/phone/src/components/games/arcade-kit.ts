// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// What every canvas game in the arcade needs: them palette as colours a canvas
// can paint with, and best scores that survive storage being unavailable.

export interface Paint {
  page: string; surface: string; velvet: string; primary: string; secondary: string;
  glow: string; spark: string; text: string; light: boolean;
}

/** Blend two #rrggbb colours; anything else comes back as the first. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = /^#([0-9a-f]{6})$/i.exec(a.trim());
  const pb = /^#([0-9a-f]{6})$/i.exec(b.trim());
  if (!pa || !pb) return a;
  const na = parseInt(pa[1], 16);
  const nb = parseInt(pb[1], 16);
  const ch = (shift: number) => {
    const x = (na >> shift) & 255;
    const y = (nb >> shift) & 255;
    return Math.round(x + (y - x) * Math.min(1, Math.max(0, t)));
  };
  return `#${[ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The same colour at zero alpha. Fading a colour into plain 'transparent'
 * fades it through black, which shows as a grey ring on a light sky.
 */
export function clearOf(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return 'rgba(255, 255, 255, 0)';
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0)`;
}

export function luminance(color: string): number {
  const m = color.match(/^#([0-9a-f]{6})/i);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

// Canvas can't read var(--…), so palette colours are resolved to their values.
export function canvasColor(value: string | undefined, fallback: string): string {
  const v = (value ?? '').trim();
  if (!v) return fallback;
  if (v.startsWith('var(')) {
    const name = v.slice(4, -1).split(',')[0].trim();
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return canvasColor(resolved, fallback);
  }
  return /^(#|rgb|hsl)/i.test(v) ? v : fallback;
}

/** Them live palette, read off the page, with the theme's flat colours as the fallback. */
export function readPaint(raw: any): Paint {
  const css = getComputedStyle(document.documentElement);
  const pal = (name: string, fallback: string) => canvasColor(css.getPropertyValue(name), fallback);
  const accent = canvasColor(raw.accent, '#8b7cff');
  const page = pal('--pal-page', canvasColor(raw.pageBg, '#0d0d14'));
  return {
    page,
    surface: pal('--pal-surface', canvasColor(raw.panelBg, page)),
    velvet: pal('--pal-velvet', accent),
    primary: pal('--pal-primary', accent),
    secondary: pal('--pal-secondary', accent),
    glow: pal('--pal-glow', accent),
    spark: pal('--pal-spark', accent),
    text: pal('--pal-text', canvasColor(raw.textMain, '#ffffff')),
    light: luminance(page) > 0.6,
  };
}

// localStorage can be missing or throw (private windows, blocked storage); a
// best score is nice to keep, never worth crashing a game over.
export function readNumber(key: string): number {
  try {
    const n = parseInt(localStorage.getItem(key) ?? '', 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function readText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeValue(key: string, value: string | number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable */
  }
}

/** Size a canvas for the screen's real pixel density and draw in field units. */
export function fitCanvas(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// ── Words over a moving picture ─────────────────────────────────────────────
// The pop-ups ("Level 3", "Dusk", "+10") used to be drawn in a palette colour
// with a blurred shadow, so on a pale day page or a dark sea of the same hue
// they drowned (theirs, Nov 11 2026: 'a color pass for legibility on all of the
// themes'). A label now reads what is actually painted behind it and leans its
// ink just far enough toward white or black to read, with a thin crisp edge.

/** WCAG relative luminance of a #rrggbb colour. */
function relLum(color: string): number {
  const m = /^#([0-9a-f]{6})/i.exec(color.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The average colour already painted under a box given in field units, or null if it cannot be read. */
export function colorBehind(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): string | null {
  try {
    const m = ctx.getTransform();
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    const left = Math.max(0, Math.round(m.a * x + m.e));
    const top = Math.max(0, Math.round(m.d * y + m.f));
    const right = Math.min(cw, Math.round(m.a * (x + w) + m.e));
    const bottom = Math.min(ch, Math.round(m.d * (y + h) + m.f));
    if (right - left < 1 || bottom - top < 1) return null;
    const data = ctx.getImageData(left, top, right - left, bottom - top).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4 * 3) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
    if (!n) return null;
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch {
    return null;
  }
}

/** The wanted ink, leaned toward white or near-black only as far as it takes to read on `behind` at 4.5 to 1. */
export function readableInk(want: string, behind: string, ratio = 4.5): string {
  if (contrastRatio(want, behind) >= ratio) return want;
  // Above this luminance black reads better than white.
  const toward = relLum(behind) > 0.179 ? '#0b0b0f' : '#ffffff';
  for (let t = 0.1; t < 1; t += 0.1) {
    const ink = mixHex(want, toward, t);
    if (contrastRatio(ink, behind) >= ratio) return ink;
  }
  return toward;
}

/**
 * A centred label over the scene: ink chosen against what is painted behind
 * it, a thin edge in the opposite tone, no blur. The caller's globalAlpha
 * (a fade) still applies.
 */
export function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  p: Paint,
  opts: { size: number; ink: string; weight?: number },
) {
  const size = opts.size;
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${opts.weight ?? 600} ${size}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width;
  const behind = colorBehind(ctx, x - w / 2, y - size * 0.8, w, size) ?? p.page;
  // Large text reads at 3 to 1 (WCAG's large-text line), so the big pop-ups keep more of their colour.
  const ink = readableInk(opts.ink, behind, size >= 20 ? 3 : 4.5);
  const darkEdge = relLum(ink) > 0.179;
  const fade = ctx.globalAlpha;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.16);
  ctx.strokeStyle = darkEdge ? '#000000' : '#ffffff';
  ctx.globalAlpha = fade * (darkEdge ? 0.4 : 0.55);
  ctx.strokeText(text, x, y);
  ctx.globalAlpha = fade;
  ctx.fillStyle = ink;
  ctx.fillText(text, x, y);
  ctx.restore();
}
