// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// What is on the screen is kept apart between the phone and the laptop. Both screens push the
// whole settings blob, and each only reads it when it opens, so a phone that
// has been open all evening pushes the laptop's screen choices as they were
// when it opened, and the laptop's own choices come back changed. So a push says which screen it came from, and
// the house keeps the OTHER screen's own choices as it has them.

/** The screen choices the laptop keeps for itself under theme.deskScreen,
 *  and the phone keeps at the top of the theme. The look of the house
 *  (theme, bubbles, colors) is shared and is not in this list. */
export const DESK_SCREEN_KEYS = [
  'homeWidgets', 'homeQuietScroll', 'homeQuietLine', 'homeCardStyle', 'homeCompanionsCard', 'homeQuietCard',
  'dockIconCards', 'dockCardBacks',
  'lockHidden', 'lockShow', 'lockShortcuts', 'lockFace', 'lockClockSize', 'lockCards', 'lockCardBacks',
  'lockWeatherLook', 'lockSpotify', 'lockSpotifyLook',
] as const;

/** Theme keys only the laptop writes: its own screen choices and where its widgets sit. */
export const DESK_OWN_THEME_KEYS = ['deskScreen', 'homeWidgetPlacesDesk', 'lockSpotsDesk'] as const;

/** Theme keys only the phone writes: its screen choices and where its widgets sit. */
export const PHONE_OWN_THEME_KEYS = [...DESK_SCREEN_KEYS, 'homeWidgetPlaces', 'homeWidgetSpots', 'lockSpots'] as const;

export type SettingsScreen = 'phone' | 'desk';

export function settingsScreenOf(value: unknown): SettingsScreen | null {
  return value === 'phone' || value === 'desk' ? value : null;
}

/**
 * The blob to store when `screen` pushes `incoming` over `stored`: everything
 * as pushed, except the other screen's own theme keys, which stay as the house
 * has them (absent stays absent). A push that does not say its screen, or a
 * house with nothing stored, is taken whole, as before.
 */
export function keepOtherScreen<T extends { theme?: unknown }>(stored: unknown, incoming: T, screen: SettingsScreen | null): T {
  if (!screen) return incoming;
  const storedTheme = stored && typeof stored === 'object' ? (stored as { theme?: unknown }).theme : undefined;
  const theme = incoming.theme;
  if (!storedTheme || typeof storedTheme !== 'object' || !theme || typeof theme !== 'object') return incoming;
  const keep: readonly string[] = screen === 'phone' ? DESK_OWN_THEME_KEYS : PHONE_OWN_THEME_KEYS;
  const from = storedTheme as Record<string, unknown>;
  const out: Record<string, unknown> = { ...(theme as Record<string, unknown>) };
  for (const k of keep) {
    if (k in from) out[k] = from[k];
    else delete out[k];
  }
  return { ...incoming, theme: out };
}
