// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A rebuild renames every lazy chunk. A page opened before the rebuild still
// asks for the old names, and the import fails ("Failed to fetch dynamically
// imported module"). The cure is the new index: reload once. The stamp in
// sessionStorage keeps a genuinely missing file from reloading forever.

const KEY = 'aerie.staleBuildReloadAt';
const QUIET_MS = 30_000;

export function isStaleChunkError(message: string | undefined | null): boolean {
  if (!message) return false;
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(message);
}

/** True when a reload is allowed now (and records it), false inside the quiet window. */
export function claimStaleReload(store: Pick<Storage, 'getItem' | 'setItem'>, now: number): boolean {
  const last = Number(store.getItem(KEY) || 0);
  if (last && now - last < QUIET_MS) return false;
  store.setItem(KEY, String(now));
  return true;
}

/** Reload once for a stale chunk. Returns true when a reload was started. */
export function reloadForStaleChunk(message: string | undefined | null): boolean {
  if (!isStaleChunkError(message)) return false;
  try {
    if (!claimStaleReload(window.sessionStorage, Date.now())) return false;
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
