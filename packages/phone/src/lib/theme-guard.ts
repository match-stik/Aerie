// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * A saved theme arrives from three places (localStorage, IndexedDB and the
 * server copy) and every screen reads THEMES[id][mode] straight off it. A
 * mode that is not light or dark made that undefined and the whole app fell
 * over to the error card (found by a test browser fed a bad value). An
 * unknown id already fell back to monochrome at the read; this makes both
 * safe at the door.
 */
/** The seventeen retired single-accent themes. A saved one moves to the
 *  palette the design file matched it to (docs/themes/AERIE-THEMES.md §6),
 *  so nobody opens the app to a theme that is no longer on the picker.
 *  Custom is not retired. */
export const RETIRED_ACCENTS: Readonly<Record<string, string>> = {
  orange: 'pal-ember', crimson: 'pal-garnet', burgundy: 'pal-oxbloodnavy',
  rose: 'pal-rosepine', magenta: 'pal-catppuccin', blush: 'pal-rosepine',
  plum: 'pal-plum', lavender: 'pal-amethyst', monochrome: 'pal-obsidian',
  sapphire: 'pal-inkwell', cobalt: 'pal-smoke', sky: 'pal-nord',
  ocean: 'pal-tidewater', teal: 'pal-tidewater', emerald: 'pal-evergreen',
  forest: 'pal-evergreen', mocha: 'pal-espresso',
};

export function guardTheme<T extends { mode?: unknown; id?: unknown }>(
  theme: T,
  knownIds: ReadonlySet<string>,
): T & { mode: 'light' | 'dark' } {
  const mode = theme.mode === 'light' || theme.mode === 'dark' ? theme.mode : 'dark';
  const raw = typeof theme.id === 'string' ? (RETIRED_ACCENTS[theme.id] ?? theme.id) : '';
  const id = knownIds.has(raw) ? raw : 'pal-obsidian';
  return { ...theme, mode, id };
}
