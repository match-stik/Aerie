// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * Wallpapers used to live inside the settings as pictures written out in
 * text (data: URLs). That could put the settings at ten megabytes and more,
 * and the phone sends the whole blob back to the house a second after any
 * change, so every tap in Settings queued megabytes of upload in front of
 * chat pictures and sticker thumbnails. Each wallpaper now goes into the
 * house's file store, the way chat photos live, and the settings keep only a
 * short link to it.
 *
 * Two rules keep the pictures safe while they move. A picture is swapped for
 * its link only after the house has answered with the stored file and its
 * size matches what was sent. And nothing moves at all unless the house has
 * said it keeps files that the settings link to (keepsLinkedFiles on GET
 * /api/app-settings), because a house without that would count the moved
 * pictures as orphans and Clean orphans would delete them. The upload itself
 * is storeInlinePicture in aerie/settings-sync.ts; this file stays pure so
 * the swapping can be tested on its own.
 */
import type { AppTheme } from '../types';

type WallpaperSet = { wallpaper?: string; lockScreenWallpaper?: string; wallpapers?: string[] };

const INLINE = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i;

function isInline(value: unknown): value is string {
  return typeof value === 'string' && INLINE.test(value);
}

function setsOf(theme: AppTheme): WallpaperSet[] {
  const sets: WallpaperSet[] = [theme];
  for (const mode of ['light', 'dark'] as const) {
    const filed = theme.modeWallpapers?.[mode];
    if (filed) sets.push(filed);
  }
  return sets;
}

/** Every inline picture in the theme's wallpaper fields, each one once,
 *  however many places hold it (a Midnight set can repeat the live one). */
export function inlineWallpapers(theme: AppTheme): string[] {
  const found = new Set<string>();
  for (const set of setsOf(theme)) {
    if (isInline(set.wallpaper)) found.add(set.wallpaper);
    if (isInline(set.lockScreenWallpaper)) found.add(set.lockScreenWallpaper);
    for (const picture of set.wallpapers || []) if (isInline(picture)) found.add(picture);
  }
  return [...found];
}

function swapSet<T extends WallpaperSet>(set: T, links: ReadonlyMap<string, string>): T {
  const swap = (value: string | undefined) => (value !== undefined && links.get(value)) || value;
  const next = { ...set };
  if (set.wallpaper !== undefined) next.wallpaper = swap(set.wallpaper);
  if (set.lockScreenWallpaper !== undefined) next.lockScreenWallpaper = swap(set.lockScreenWallpaper);
  if (Array.isArray(set.wallpapers)) next.wallpapers = set.wallpapers.map((p) => swap(p) as string);
  return next;
}

/** The theme with each inline picture that has a link swapped for it.
 *  Anything without a link, including a picture chosen while the upload
 *  was running, is left exactly as it was. */
export function swapWallpapers(theme: AppTheme, links: ReadonlyMap<string, string>): AppTheme {
  if (links.size === 0) return theme;
  const next = swapSet(theme, links);
  if (theme.modeWallpapers) {
    const filed: AppTheme['modeWallpapers'] = {};
    for (const [mode, set] of Object.entries(theme.modeWallpapers) as Array<[keyof NonNullable<AppTheme['modeWallpapers']>, WallpaperSet | undefined]>) {
      filed[mode] = set ? swapSet(set, links) : set;
    }
    next.modeWallpapers = filed;
  }
  return next;
}

export const EXTENSION: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };

/** A data: URL as the bytes it spells out, or null if it is not one. */
export function inlineToBlob(dataUrl: string): Blob | null {
  const match = INLINE.exec(dataUrl);
  if (!match) return null;
  try {
    const binary = atob(dataUrl.slice(match[0].length));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1].toLowerCase() });
  } catch {
    return null;
  }
}
