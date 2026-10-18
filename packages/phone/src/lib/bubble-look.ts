// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// How the chat bubbles look, apart from drawing them (the Bubbles page of the
// Personalize menu). Each switch starts as the bubbles have always looked, so
// nothing is applied all at once: faces stay on, and names over companion
// bubbles, edges in companion colors and quieter action lines wait to be
// turned on. Kept free of imports so it can be tested.

export interface BubbleLook {
  /** Each companion's face beside their bubbles, and the owner's beside theirs. */
  faces: boolean;
  /** Each companion named in small capitals in their color: over their
   *  bubbles, or under them beside the face when their tails are at the bottom. */
  names: boolean;
  /** A companion bubble's thin border in that companion's color instead of the theme's. */
  edges: boolean;
  /** Action lines (the italics) a little quieter than the words. */
  quietActions: boolean;
  /** The owner's own name in their color, over their bubbles, or under them
   *  beside their face when their tail is at the bottom (a name up top reads
   *  strangely with the face down below). */
  myName: boolean;
  /** Which corner each side's tail comes from: the top, as it always has,
   *  or the bottom, with the face beside it moving down to meet it. With a
   *  bottom tail and a name showing, the name and the time share one line
   *  under the bubble: the name by the face, the time at the far end. The
   *  typing dots and the Settings previews follow
   *  the same switch. */
  tailMine: Tail;
  tailOurs: Tail;
  /** The tail's shape on both sides: the point, or a swoop curling out of
   *  that same corner. */
  tailShape: TailShape;
  /** The rings round every face: each in its own color as set in the house, or all in the theme's two-tone fill, the one
   *  selected things wear. A guest's ring stays the theme's accent either way. */
  rings: Rings;
}

export type Tail = 'top' | 'bottom';
export type TailShape = 'point' | 'swoop';
export type Rings = 'house' | 'theme';

/** The bubbles as they have always looked. */
export const DEFAULT_LOOK: BubbleLook = { faces: true, names: false, edges: false, quietActions: false, myName: false, tailMine: 'top', tailOurs: 'top', tailShape: 'point', rings: 'house' };

export function bubbleLookOf(theme: { bubbleFaces?: unknown; bubbleNames?: unknown; bubbleEdges?: unknown; bubbleQuietActions?: unknown; bubbleMyName?: unknown; bubbleTailMine?: unknown; bubbleTailOurs?: unknown; bubbleTailShape?: unknown; bubbleRings?: unknown }): BubbleLook {
  return {
    faces: theme.bubbleFaces !== false,
    names: theme.bubbleNames === true,
    edges: theme.bubbleEdges === true,
    quietActions: theme.bubbleQuietActions === true,
    myName: theme.bubbleMyName === true,
    tailMine: theme.bubbleTailMine === 'bottom' ? 'bottom' : 'top',
    tailOurs: theme.bubbleTailOurs === 'bottom' ? 'bottom' : 'top',
    tailShape: theme.bubbleTailShape === 'swoop' ? 'swoop' : 'point',
    rings: theme.bubbleRings === 'theme' ? 'theme' : 'house',
  };
}

export interface BubbleCorners {
  borderTopLeftRadius: string;
  borderTopRightRadius: string;
  borderBottomLeftRadius: string;
  borderBottomRightRadius: string;
}

/** A drawn bubble's four corners as four separate values: the pointed one at
 *  0 and the rest at the shape slider's radius. Always all four. An inline
 *  style that mixes the border-radius shorthand with one corner breaks the
 *  moment the pointed corner moves: React clears the old corner, which wipes
 *  it to 0 instead of handing it back to the shorthand (switching to Bottom
 *  left the top corner pointed too, in the preview only, because the chat
 *  draws its corners with classes). */
export function bubbleCorners(side: 'mine' | 'ours', tail: Tail): BubbleCorners {
  const round = 'var(--shape-bubble)';
  const pointed = side === 'mine' ? (tail === 'bottom' ? 'br' : 'tr') : (tail === 'bottom' ? 'bl' : 'tl');
  return {
    borderTopLeftRadius: pointed === 'tl' ? '0' : round,
    borderTopRightRadius: pointed === 'tr' ? '0' : round,
    borderBottomLeftRadius: pointed === 'bl' ? '0' : round,
    borderBottomRightRadius: pointed === 'br' ? '0' : round,
  };
}

function rgbOf(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const ch = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** How well one color reads on another, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const x = rgbOf(a), y = rgbOf(b);
  if (!x || !y) return 21;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/** A companion's name color on this page: their own color, lifted toward
 *  white at night (black by day) until it reads at 4.5 to 1. The ring keeps
 *  the real color; only the name is lifted. */
export function nameColor(slug: string, color: string | null, mode: 'light' | 'dark', page: string): string {
  const base = rgbOf(color || '') ?? [136, 136, 136];
  const pageHex = rgbOf(page) ? page : mode === 'dark' ? '#000000' : '#ffffff';
  const toward: [number, number, number] = mode === 'dark' ? [255, 255, 255] : [0, 0, 0];
  for (let k = 0; k <= 1.0001; k += 0.05) {
    const mixed: [number, number, number] = [0, 1, 2].map((i) => base[i] + (toward[i] - base[i]) * k) as [number, number, number];
    const hex = toHex(mixed);
    if (contrastRatio(hex, pageHex) >= 4.5) return hex;
  }
  return toHex(toward);
}
