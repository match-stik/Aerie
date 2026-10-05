// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Sticker pack cache shared by the chat composer's picker and the
// MessageBubble inline-ref renderer. The backend persists packs +
// stickers — we just mirror them client-side.

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

export function resolveStickerRef(ref: string): string | null {
  return refIndex.get(ref) || null;
}
