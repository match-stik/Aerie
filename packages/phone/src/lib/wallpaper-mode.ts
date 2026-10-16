// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * A wallpaper for Daylight and one for Midnight, swapped when the owner flips
 * the mode. Every screen keeps reading the theme's ordinary wallpaper fields;
 * this only decides what those fields hold. On a flip the set on screen is
 * filed under the mode being left, and the set filed under the mode being
 * entered comes out, if there is one. With nothing
 * filed yet for the new mode, the current pictures simply stay, so turning
 * this on never blanks a screen.
 */
export interface WallpaperSet {
  wallpaper?: string;
  lockScreenWallpaper?: string;
  wallpapers?: string[];
  slideshowEnabled?: boolean;
}

type Mode = 'light' | 'dark';
type Themed = WallpaperSet & {
  mode: Mode;
  wallpaperFollowsMode?: boolean;
  modeWallpapers?: Partial<Record<Mode, WallpaperSet>>;
};

const FIELDS = ['wallpaper', 'lockScreenWallpaper', 'wallpapers', 'slideshowEnabled'] as const;

function setOf(t: WallpaperSet): WallpaperSet {
  const out: WallpaperSet = {};
  for (const k of FIELDS) if (t[k] !== undefined) (out as Record<string, unknown>)[k] = t[k];
  return out;
}

export function applyThemeUpdate<T extends Themed>(prev: T, updates: Partial<T>): T {
  const next = { ...prev, ...updates } as T;
  const flipped = updates.mode !== undefined && updates.mode !== prev.mode;
  if (!flipped || !next.wallpaperFollowsMode) return next;
  const filed = { ...(prev.modeWallpapers || {}), [prev.mode]: setOf(prev) };
  const incoming = filed[next.mode];
  if (!incoming) return { ...next, modeWallpapers: filed };
  const cleared: WallpaperSet = { wallpaper: undefined, lockScreenWallpaper: undefined, wallpapers: undefined, slideshowEnabled: undefined };
  return { ...next, ...cleared, ...incoming, modeWallpapers: filed };
}
