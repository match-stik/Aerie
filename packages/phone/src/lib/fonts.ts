// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The house's fonts: a font for titles, a separate one for messages, and a
// size slider. Every face is self-hosted in public/fonts with its license beside it, so a phone never
// falls back to whatever it has. Before this, titles asked for Playfair Display
// and nothing ever loaded it, so phones drew their own Noto Serif everywhere;
// that is why Noto Serif is where an unset title and a serif setting start.
// Kept free of imports so it can be tested.

export type TitleFont = 'noto' | 'playfair' | 'cormorant' | 'robotoslab';
export type BodyFont = 'noto' | 'geist' | 'mono';

export const TITLE_FONTS: { id: TitleFont; name: string; stack: string }[] = [
  { id: 'noto', name: 'Noto Serif', stack: '"Noto Serif", serif' },
  { id: 'playfair', name: 'Playfair Display', stack: '"Playfair Display", "Noto Serif", serif' },
  { id: 'cormorant', name: 'Cormorant Garamond', stack: '"Cormorant Garamond", "Noto Serif", serif' },
  { id: 'robotoslab', name: 'Roboto Slab', stack: '"Roboto Slab", "Noto Serif", serif' },
];

export const BODY_FONTS: { id: BodyFont; name: string; stack: string }[] = [
  { id: 'noto', name: 'Noto Serif', stack: '"Noto Serif", serif' },
  { id: 'geist', name: 'Geist', stack: '"Geist", ui-sans-serif, system-ui, sans-serif' },
  { id: 'mono', name: 'JetBrains Mono', stack: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace' },
];

export const FONT_SCALE_MIN = 0.9;
export const FONT_SCALE_MAX = 1.2;

export interface HouseFonts {
  title: TitleFont;
  body: BodyFont;
  /** Multiplies the root size, 16px at 1. */
  scale: number;
}

interface FontSettings {
  fontTitle?: unknown;
  fontBody?: unknown;
  fontScale?: unknown;
  /** The old single switch, read only to start the new ones where it was. */
  fontFamily?: unknown;
  /** The old three sizes, read the same way. */
  fontSize?: unknown;
}

/**
 * The owner's fonts, starting from how the phone looks today: the old switch's serif
 * becomes Noto Serif (what actually drew), sans becomes Geist and mono stays
 * mono; the old small and large become their slider places. `themeFamily` is
 * the theme's own font when the owner never picked one.
 */
export function fontsOf(settings: FontSettings, themeFamily = 'font-sans'): HouseFonts {
  const title = TITLE_FONTS.some((f) => f.id === settings.fontTitle) ? settings.fontTitle as TitleFont : 'noto';
  let body: BodyFont;
  if (BODY_FONTS.some((f) => f.id === settings.fontBody)) body = settings.fontBody as BodyFont;
  else {
    const old = typeof settings.fontFamily === 'string' && settings.fontFamily ? settings.fontFamily : themeFamily;
    body = old === 'font-serif' ? 'noto' : old === 'font-mono' ? 'mono' : 'geist';
  }
  let scale: number;
  if (typeof settings.fontScale === 'number' && Number.isFinite(settings.fontScale)) {
    scale = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, settings.fontScale));
  } else {
    scale = settings.fontSize === 'small' ? 0.9 : settings.fontSize === 'large' ? 1.125 : 1;
  }
  return { title, body, scale };
}

export function titleStack(id: TitleFont): string {
  return (TITLE_FONTS.find((f) => f.id === id) ?? TITLE_FONTS[0]).stack;
}

export function bodyStack(id: BodyFont): string {
  return (BODY_FONTS.find((f) => f.id === id) ?? BODY_FONTS[0]).stack;
}
