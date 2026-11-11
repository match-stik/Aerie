// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Sticker pack cache shared by the chat composer's picker and the
// MessageBubble inline-ref renderer. The backend persists packs +
// stickers — we just mirror them client-side.

import { useEffect, useState } from 'react';
import { apiFetch } from './api';

export interface BackendSticker {
  id: string;
  name: string;
  filename: string;
  pack_id: string;
  url: string;
  created_at: string;
}

export interface BackendStickerPack {
  id: string;
  name: string;
  description?: string;
  stickers?: BackendSticker[];
}

let cachedPacks: BackendStickerPack[] = [];
let inflight: Promise<BackendStickerPack[]> | null = null;
let loaded = false;

// Map `${packName}_${stickerName}` → url for fast inline rendering.
let refIndex: Map<string, string> = new Map();

// Anything showing stickers needs telling when this cache changes, not just the
// thing that asked for the change. The sticker SHEET refreshes itself on open,
// which fixed the sheet — and the composer's `::` tray reads the same cache and
// was never told, so a sticker uploaded in Packs stayed missing from the tray
// until the whole app was reloaded. One cache, several readers, one signal.
type StickerListener = () => void;
const listeners = new Set<StickerListener>();

export function subscribeStickers(listener: StickerListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function rebuildIndex() {
  refIndex = new Map();
  for (const pack of cachedPacks) {
    for (const sticker of pack.stickers || []) {
      refIndex.set(`${pack.name}_${sticker.name}`, sticker.url);
    }
  }
  for (const listener of listeners) {
    try { listener(); } catch { /* a bad listener must not poison a refresh */ }
  }
}

export async function loadStickers(force = false): Promise<BackendStickerPack[]> {
  if (loaded && !force && cachedPacks.length > 0) return cachedPacks;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await apiFetch('/api/stickers/packs-with-stickers');
      if (!res.ok) throw new Error(`Stickers fetch failed: ${res.status}`);
      const data = (await res.json()) as BackendStickerPack[];
      cachedPacks = Array.isArray(data) ? data : [];
      rebuildIndex();
      loaded = true;
      return cachedPacks;
    } catch (err) {
      console.warn('[Aerie] Stickers fetch failed:', err);
      return cachedPacks;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function getStickerPacks(): BackendStickerPack[] {
  return cachedPacks;
}

// A ref we don't know yet is usually a sticker made since the app opened
// (theirs, Oct 27 2026: 'I still have to close the app and reopen it for them to
// show up on your bubbles when you make new ones'). So a miss asks the house
// for the list again, at most once every fifteen seconds, and the bubbles that
// listen re-render when it lands. A ref that is simply wrong stays text.
const MISS_REFRESH_MS = 15_000;
let lastMissRefresh = 0;

export function resolveStickerRef(ref: string): string | null {
  const url = refIndex.get(ref);
  if (url) return url;
  if (loaded && Date.now() - lastMissRefresh > MISS_REFRESH_MS) {
    lastMissRefresh = Date.now();
    void loadStickers(true);
  }
  return null;
}

/** Re-renders the caller whenever the sticker list changes. */
export function useStickerVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeStickers(() => setVersion((v) => v + 1)), []);
  return version;
}
