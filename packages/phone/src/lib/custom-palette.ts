// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The Custom colors as a full palette. Custom predates the palettes and
// fed only eleven colors through its own path, so it missed the solid bubbles,
// the two-color boxes, the tiles, the fitted inks and everything else a
// palette paints. Now the eleven colors the person picks are turned into the same
// Palette shape every built-in theme has, and Custom goes down the palettes'
// road. Their picks are kept where a palette has a matching place; the rest
// (the second color, glow, wash) are drawn from them.
import type { Palette } from './palettes';
import { mixHex } from './bubble-look';

export type CustomModeColors = Record<string, string | undefined>;
export interface CustomColors { light: CustomModeColors; dark: CustomModeColors }

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A picked color as a solid hex: an 8-digit #RRGGBBAA is laid over `under`
 *  (the starter colors carried 60% bubbles, which is why they read see-through). */
export function opaque(color: string | undefined, under: string, fallback: string): string {
  const c = (color || '').trim();
  if (!HEX.test(c)) return fallback;
  if (c.length === 9) {
    const alpha = parseInt(c.slice(7, 9), 16) / 255;
    return mixHex(c.slice(0, 7), Math.round(alpha * 100), under);
  }
  if (c.length === 4) return `#${c.slice(1).split('').map((x) => x + x).join('')}`;
  return c;
}

const NIGHT_DEFAULTS = { pageBg: '#09090B', panelBg: '#18181B', textMain: '#FAFAFA', textMuted: '#A1A1AA', accent: '#FAFAFA', userBubbleBg: '#52525B', compBubbleBg: '#27272A' };
const DAY_DEFAULTS = { pageBg: '#F4F4F5', panelBg: '#FFFFFF', textMain: '#18181B', textMuted: '#71717A', accent: '#18181B', userBubbleBg: '#A1A1AA', compBubbleBg: '#E4E4E7' };

export function customPalette(colors: CustomColors | undefined): Palette {
  const n = colors?.dark ?? {};
  const d = colors?.light ?? {};
  const nPage = opaque(n.pageBg, '#000000', NIGHT_DEFAULTS.pageBg);
  const nSurface = opaque(n.panelBg, nPage, NIGHT_DEFAULTS.panelBg);
  const nAccent = opaque(n.accent, nPage, NIGHT_DEFAULTS.accent);
  const nText = opaque(n.textMain, nSurface, NIGHT_DEFAULTS.textMain);
  const nMuted = opaque(n.textMuted, nSurface, NIGHT_DEFAULTS.textMuted);
  const nUser = opaque(n.userBubbleBg, nPage, NIGHT_DEFAULTS.userBubbleBg);
  const nComp = opaque(n.compBubbleBg, nPage, NIGHT_DEFAULTS.compBubbleBg);
  const dPage = opaque(d.pageBg, '#FFFFFF', DAY_DEFAULTS.pageBg);
  const dSurface = opaque(d.panelBg, dPage, DAY_DEFAULTS.panelBg);
  const dAccent = opaque(d.accent, dPage, DAY_DEFAULTS.accent);
  const dText = opaque(d.textMain, dSurface, DAY_DEFAULTS.textMain);
  const dMuted = opaque(d.textMuted, dSurface, DAY_DEFAULTS.textMuted);
  const dUser = opaque(d.userBubbleBg, dPage, DAY_DEFAULTS.userBubbleBg);
  const dComp = opaque(d.compBubbleBg, dPage, DAY_DEFAULTS.compBubbleBg);
  return {
    id: 'custom',
    name: 'Custom',
    band: 'Custom',
    night: {
      primary: nAccent,
      secondary: mixHex(nAccent, 60, nPage),
      glow: nMuted,
      spark: mixHex(nAccent, 70, nText),
      velvet: mixHex(nAccent, 35, nPage),
      deep: nPage,
      surface: nSurface,
      text: nText,
      muted: nMuted,
      ink: nText,
      number2: mixHex(nAccent, 70, nText),
      bubbleUser: [nUser, mixHex(nUser, 80, nPage)],
      bubbleComp: [nComp, mixHex(nComp, 85, nPage)],
    },
    day: {
      primary: dAccent,
      secondary: mixHex(dAccent, 70, dPage),
      glow: dMuted,
      spark: mixHex(dAccent, 70, dText),
      wash: mixHex(dAccent, 12, dPage),
      page: dPage,
      surface: dSurface,
      text: dText,
      muted: dMuted,
      ink: dText,
      bubbleUser: [dUser, mixHex(dUser, 85, dPage)],
      bubbleComp: [dComp, mixHex(dComp, 90, dPage)],
      soft: { page: dPage, surface: dSurface, muted: dMuted, glow: dMuted },
    },
  };
}
