// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The person's own themes, kept by name. The Custom builder is still one working slot; a
// saved theme is a named copy of its colors, both modes, that shows in the
// picker beside the palettes. Choosing one loads it into the slot, and Update
// writes the slot back over it.
import type { AppTheme as ThemeConfig } from '../types';

export type ThemeColorSet = { light: Record<string, string>; dark: Record<string, string> };
export interface SavedTheme { id: string; name: string; colors: ThemeColorSet }

const copyColors = (c: ThemeColorSet): ThemeColorSet => ({ light: { ...c.light }, dark: { ...c.dark } });

/** A name for a theme saved without one: My theme, My theme 2, ... */
export function nextThemeName(saved: SavedTheme[] = []): string {
  const taken = new Set(saved.map((t) => t.name.trim().toLowerCase()));
  if (!taken.has('my theme')) return 'My theme';
  let n = 2;
  while (taken.has(`my theme ${n}`)) n += 1;
  return `My theme ${n}`;
}

/** Save the working colors as a new named theme, and show it as the one in use. */
export function saveThemeAs(theme: Pick<ThemeConfig, 'customColors' | 'savedThemes'>, name: string, id: string): Partial<ThemeConfig> | null {
  if (!theme.customColors) return null;
  const saved = theme.savedThemes ?? [];
  const entry: SavedTheme = { id, name: name.trim() || nextThemeName(saved), colors: copyColors(theme.customColors) };
  return { id: 'custom', savedThemes: [...saved, entry], savedThemeId: id };
}

/** Write the working colors (and name) back over the saved theme in use. */
export function updateSavedTheme(theme: Pick<ThemeConfig, 'customColors' | 'savedThemes' | 'savedThemeId'>, name: string): Partial<ThemeConfig> | null {
  const saved = theme.savedThemes ?? [];
  const at = saved.findIndex((t) => t.id === theme.savedThemeId);
  if (at === -1 || !theme.customColors) return null;
  const next = saved.slice();
  next[at] = { ...next[at], name: name.trim() || next[at].name, colors: copyColors(theme.customColors) };
  return { savedThemes: next };
}

export function deleteSavedTheme(theme: Pick<ThemeConfig, 'savedThemes' | 'savedThemeId'>, id: string): Partial<ThemeConfig> {
  const next = (theme.savedThemes ?? []).filter((t) => t.id !== id);
  return theme.savedThemeId === id ? { savedThemes: next, savedThemeId: undefined } : { savedThemes: next };
}

/** Wear a saved theme: its colors go into the working slot. */
export function wearSavedTheme(saved: SavedTheme): Partial<ThemeConfig> {
  return { id: 'custom', customColors: copyColors(saved.colors), savedThemeId: saved.id };
}
