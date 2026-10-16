// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Cross-browser app-settings sync against /api/app-settings (NOT
// /api/settings — that's the agent-config KV route, which shadowed this
// blob's original path for two months). The server stores a single JSON
// blob keyed per install; theme, contacts and the rest of appSettings
// all live inside it so phone and laptop see the same prefs without
// manual export/import.
//
// localStorage still acts as the fast-path cache for first paint; this
// just keeps the server copy fresh and seeds new browsers from it.

import { apiFetch } from './api';
import { EXTENSION, inlineToBlob } from '../lib/wallpaper-files';
import type { AppSettings, AppTheme, ContactProfile } from '../types';

export interface ServerSettingsBlob {
  theme?: AppTheme;
  contacts?: Record<string, ContactProfile>;
  appSettings?: Partial<AppSettings>;
  // Small localStorage strings that ride along so the server copy is a
  // complete setup: reactions/bookmarks, Studio picks, game bests, radar
  // notes (see EXTRA_KEYS in components/SetupSync.tsx). Applied only by
  // the explicit "bring my setup here" flow, never by passive reconcile.
  extras?: Record<string, string>;
}

// Why an error class instead of just returning null: the previous code
// returned null for both "server legitimately has no blob yet" and
// "fetch failed" (network blip, 401, parse error). The caller couldn't
// tell them apart, so it marked hydration complete on failure too —
// and the push-on-state-change effect then overwrote the server's real
// data with the local defaults. Throwing on failure lets the caller
// keep hydration blocked when the server's answer is unknown.
export class SettingsSyncError extends Error {
  constructor(public reason: 'network' | 'unauth' | 'server' | 'parse', message?: string) {
    super(message ?? reason);
    this.name = 'SettingsSyncError';
  }
}

// Returns the blob on success (null = server confirmed empty, please
// seed me); throws SettingsSyncError on any failure.
export async function fetchServerSettings(): Promise<ServerSettingsBlob | null> {
  let res: Response;
  try {
    res = await apiFetch('/api/app-settings');
  } catch (e) {
    throw new SettingsSyncError('network', e instanceof Error ? e.message : 'network error');
  }
  if (res.status === 401 || res.status === 403) {
    throw new SettingsSyncError('unauth', `auth (${res.status})`);
  }
  if (!res.ok) {
    throw new SettingsSyncError('server', `server (${res.status})`);
  }
  let data: { settings?: ServerSettingsBlob | null; keepsLinkedFiles?: unknown };
  try {
    data = await res.json();
  } catch {
    throw new SettingsSyncError('parse', 'invalid response');
  }
  keepsLinkedFiles = data?.keepsLinkedFiles === true;
  return (data?.settings as ServerSettingsBlob | null) ?? null;
}

// Whether the house said, on the last settings read, that Clean orphans keeps
// the files its settings link to. Until it has, wallpapers stay inline
// (lib/wallpaper-files.ts explains why).
let keepsLinkedFiles = false;
export function houseKeepsLinkedFiles(): boolean {
  return keepsLinkedFiles;
}

/** Stores one inline picture in the house and returns its link, or null if
 *  the house did not confirm it, in which case the caller keeps the inline
 *  copy. Confirmed means the house answered with the stored file's id and
 *  the size it wrote matches what was sent. */
export async function storeInlinePicture(dataUrl: string): Promise<string | null> {
  const blob = inlineToBlob(dataUrl);
  const extension = blob && EXTENSION[blob.type];
  if (!blob || !extension) return null;
  try {
    const form = new FormData();
    form.append('file', blob, `wallpaper${extension}`);
    const res = await apiFetch('/api/files', { method: 'POST', body: form });
    if (!res.ok) return null;
    const stored = (await res.json()) as { fileId?: unknown; size?: unknown };
    if (typeof stored.fileId !== 'string' || stored.size !== blob.size) return null;
    return `/api/files/${stored.fileId}`;
  } catch {
    return null;
  }
}

export async function pushServerSettings(blob: ServerSettingsBlob): Promise<boolean> {
  try {
    const res = await apiFetch('/api/app-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: blob }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
