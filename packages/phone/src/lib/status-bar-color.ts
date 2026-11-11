// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The color the APK's status bar is painted, in the one form Android reads.
// Kept free of imports so it can be tested without the app around it.

/**
 * A CSS color as #rrggbb, or null when it cannot be read.
 *
 * Android's Color.parseColor takes #RRGGBB and #AARRGGBB, so a CSS
 * eight-digit hex (#RRGGBBAA, alpha LAST) would reach it with its channels
 * shifted and paint the wrong color. The alpha is dropped here instead: a
 * status bar has nothing behind it to show through.
 */
export function opaqueHex(color: string): string | null {
  const c = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{8}$/i.test(c)) return c.slice(0, 7).toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) {
    return ('#' + c.slice(1).split('').map((ch) => ch + ch).join('')).toLowerCase();
  }
  // Anything else (rgb(), a named color): let the page's own canvas read it.
  // An unreadable color leaves fillStyle on the black it started at, which
  // is the bar the APK already shows.
  const ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000000';
  ctx.fillStyle = c;
  const read = String(ctx.fillStyle);
  if (/^#[0-9a-f]{6}$/i.test(read)) return read.toLowerCase();
  const rgb = read.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!rgb) return null;
  return '#' + [rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}
