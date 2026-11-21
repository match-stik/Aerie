// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// What is on the screen is kept apart between the phone and the laptop. Both screens push the
// whole settings blob, and each only reads it when it opens, so a phone that
// has been open all evening pushes the laptop's screen choices as they were
// when it opened, and the laptop's own choices come back changed. So a push says which screen it came from, and
// the house keeps the OTHER screen's own choices as it has them.

/** The screen choices the laptop kept for itself before every setting split
 *  (Nov 16 2026). Kept for the readers that still name them; since Nov 21
 *  2026 the laptop keeps EVERY setting of its own (see isDeskOwnThemeKey). */
export const DESK_SCREEN_KEYS = [
  'homeWidgets', 'homeQuietScroll', 'homeQuietLine', 'homeCardStyle', 'homeCompanionsCard', 'homeQuietCard',
  'dockIconCards', 'dockCardBacks',
  'lockHidden', 'lockShow', 'lockShortcuts', 'lockFace', 'lockClockSize', 'lockCards', 'lockCardBacks',
  'lockWeatherLook', 'lockSpotify', 'lockSpotifyLook',
] as const;

/**
 * Every setting is the laptop's own or the phone's own. The laptop keeps its
 * copy of the theme under theme.deskScreen and its own text and send-button
 * choices under appSettings.deskApp; the phone keeps the rest of the theme at
 * the top. A theme key the laptop owns outright (its layout, its dock, the
 * places its widgets sit) starts with desk or ends in Desk and stays at the top.
 */
export function isDeskOwnThemeKey(key: string): boolean {
  return key.startsWith('desk') || key.endsWith('Desk');
}

/** App settings each screen keeps for itself: how the words look and the send button. */
export const APP_SCREEN_KEYS = ['fontTitle', 'fontBody', 'fontScale', 'fontTitleScale', 'sendIconId'] as const;

export type SettingsScreen = 'phone' | 'desk';

export function settingsScreenOf(value: unknown): SettingsScreen | null {
  return value === 'phone' || value === 'desk' ? value : null;
}

function objectOf(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * The blob to store when `screen` pushes `incoming` over `stored`. Each screen
 * only ever has the final say over its own settings: a phone push keeps the
 * laptop's (every desk theme key, appSettings.deskApp) as the house has them,
 * and a laptop push keeps the phone's (every other theme key, and the app
 * settings in APP_SCREEN_KEYS). Absent stays absent. A push that does not say
 * its screen, or a house with nothing stored, is taken whole, as before.
 * Contacts and the rest of the app settings (names, avatar) are shared.
 */
export function keepOtherScreen<T extends { theme?: unknown; appSettings?: unknown }>(stored: unknown, incoming: T, screen: SettingsScreen | null): T {
  if (!screen) return incoming;
  const storedBlob = objectOf(stored);
  if (!storedBlob) return incoming;
  let out: T = incoming;
  const storedTheme = objectOf(storedBlob.theme);
  const theme = objectOf(incoming.theme);
  if (storedTheme && theme) {
    const next: Record<string, unknown> = {};
    const ownedByPusher = (k: string) => (screen === 'desk') === isDeskOwnThemeKey(k);
    for (const [k, v] of Object.entries(theme)) if (ownedByPusher(k)) next[k] = v;
    for (const [k, v] of Object.entries(storedTheme)) if (!ownedByPusher(k)) next[k] = v;
    out = { ...out, theme: next };
  }
  const storedApp = objectOf(storedBlob.appSettings);
  const app = objectOf(incoming.appSettings);
  if (storedApp && app) {
    const next: Record<string, unknown> = { ...app };
    const keep: readonly string[] = screen === 'phone' ? ['deskApp'] : APP_SCREEN_KEYS;
    for (const k of keep) {
      if (k in storedApp) next[k] = storedApp[k];
      else delete next[k];
    }
    out = { ...out, appSettings: next };
  }
  return out;
}
