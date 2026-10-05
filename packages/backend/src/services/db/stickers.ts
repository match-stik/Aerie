// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Sticker operations
import type { StickerPack, Sticker } from '@aerie/shared';
import { getDb } from './state.js';

interface StickerRow {
  id: string;
  pack_id: string;
  name: string;
  filename: string;
  aliases: string;
  sort_order: number;
  created_at: string;
}

interface PackRow {
  id: string;
  name: string;
  description: string | null;
  entity_id: string | null;
  user_only: number;
  created_at: string;
  updated_at: string;
}

function rowToPack(row: PackRow): StickerPack {
  return {
    ...row,
    user_only: Boolean(row.user_only),
  };
}

function rowToSticker(row: StickerRow): Sticker {
  return {
    id: row.id,
    pack_id: row.pack_id,
    name: row.name,
    filename: row.filename,
    aliases: JSON.parse(row.aliases || '[]'),
    sort_order: row.sort_order,
    url: `/stickers/${row.pack_id}/${row.filename}`,
    created_at: row.created_at,
  };
}

// Pack operations
export function createStickerPack(params: {
  id: string;
  name: string;
  description?: string;
  entityId?: string;
  userOnly?: boolean;
  createdAt: string;
}): StickerPack {
  const stmt = getDb().prepare(`
    INSERT INTO sticker_packs (id, name, description, entity_id, user_only, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    params.id,
    params.name,
    params.description || null,
    params.entityId || null,
    params.userOnly ? 1 : 0,
    params.createdAt,
    params.createdAt,
  );
  return getStickerPack(params.id)!;
}

export function getStickerPack(id: string): StickerPack | null {
  const stmt = getDb().prepare('SELECT * FROM sticker_packs WHERE id = ?');
  const row = stmt.get(id) as PackRow | undefined;
  return row ? rowToPack(row) : null;
}

export function getStickerPackByName(name: string): StickerPack | null {
  const stmt = getDb().prepare('SELECT * FROM sticker_packs WHERE name = ?');
  const row = stmt.get(name) as PackRow | undefined;
  return row ? rowToPack(row) : null;
}

export function listStickerPacks(): StickerPack[] {
  const stmt = getDb().prepare('SELECT * FROM sticker_packs ORDER BY name');
  const rows = stmt.all() as PackRow[];
  return rows.map(rowToPack);
}

export function updateStickerPack(id: string, updates: {
  name?: string;
  description?: string;
  userOnly?: boolean;
}): boolean {
  const pack = getStickerPack(id);
  if (!pack) return false;

  const stmt = getDb().prepare(`
    UPDATE sticker_packs
    SET name = ?, description = ?, user_only = ?, updated_at = ?
    WHERE id = ?
  `);
  const result = stmt.run(
    updates.name ?? pack.name,
    updates.description ?? pack.description,
    updates.userOnly !== undefined ? (updates.userOnly ? 1 : 0) : (pack.user_only ? 1 : 0),
    new Date().toISOString(),
    id,
  );
  return result.changes > 0;
}

export function deleteStickerPack(id: string): boolean {
  const stmt = getDb().prepare('DELETE FROM sticker_packs WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// Sticker operations
export function createSticker(params: {
  id: string;
  packId: string;
  name: string;
  filename: string;
  aliases?: string[];
  sortOrder?: number;
  createdAt: string;
}): Sticker {
  const stmt = getDb().prepare(`
    INSERT INTO stickers (id, pack_id, name, filename, aliases, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    params.id,
    params.packId,
    params.name,
    params.filename,
    JSON.stringify(params.aliases || []),
    params.sortOrder ?? 0,
    params.createdAt,
  );
  return getSticker(params.id)!;
}

export function getSticker(id: string): Sticker | null {
  const stmt = getDb().prepare('SELECT * FROM stickers WHERE id = ?');
  const row = stmt.get(id) as StickerRow | undefined;
  return row ? rowToSticker(row) : null;
}

export function listStickers(packId?: string): Sticker[] {
  const stmt = packId
    ? getDb().prepare('SELECT * FROM stickers WHERE pack_id = ? ORDER BY sort_order, name')
    : getDb().prepare('SELECT * FROM stickers ORDER BY sort_order, name');
  const rows = (packId ? stmt.all(packId) : stmt.all()) as StickerRow[];
  return rows.map(rowToSticker);
}

export function updateSticker(id: string, updates: {
  name?: string;
  aliases?: string[];
  sortOrder?: number;
  filename?: string;
}): boolean {
  const sticker = getSticker(id);
  if (!sticker) return false;

  const stmt = getDb().prepare(`
    UPDATE stickers SET name = ?, aliases = ?, sort_order = ?, filename = ? WHERE id = ?
  `);
  const result = stmt.run(
    updates.name ?? sticker.name,
    JSON.stringify(updates.aliases ?? sticker.aliases),
    updates.sortOrder ?? sticker.sort_order,
    updates.filename ?? sticker.filename,
    id,
  );
  return result.changes > 0;
}

export function deleteSticker(id: string): boolean {
  const stmt = getDb().prepare('DELETE FROM stickers WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

export function getStickerByRef(packName: string, stickerName: string): Sticker | null {
  const stmt = getDb().prepare(`
    SELECT s.* FROM stickers s
    JOIN sticker_packs p ON s.pack_id = p.id
    WHERE p.name = ? AND (s.name = ? OR EXISTS (
      SELECT 1 FROM json_each(s.aliases) WHERE json_each.value = ?
    ))
  `);
  const row = stmt.get(packName, stickerName, stickerName) as StickerRow | undefined;
  return row ? rowToSticker(row) : null;
}

export function getPacksWithStickers(): Array<StickerPack & { stickers: Sticker[] }> {
  const packs = listStickerPacks();
  return packs.map(pack => ({
    ...pack,
    stickers: listStickers(pack.id),
  }));
}
