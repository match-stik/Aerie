// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * Every stored file something in the house still points at, which is what
 * "Clean orphans" in the Files app keeps. Anything not in here is deleted, so
 * a table that holds a file id and is missing from this list loses its files.
 * An outside audit found three missing, all live: read-aloud audio
 * (message_tts), the voice notes left at their person's places (thresholds) and the
 * Press's page thumbnails (press_spreads.thumbnail_file_id). The test beside
 * this file walks every table for a column that names a file, so a fourth
 * cannot be added quietly.
 */
import type Database from 'better-sqlite3';

const LINKED_FILE = /(?:\/api\/files|data\/files)\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/gi;

/** Every stored-file id a piece of text names, by link or by path. */
export function addLinkedIds(text: string, into: Set<string>): void {
  for (const match of text.matchAll(LINKED_FILE)) into.add(match[1].toLowerCase());
}

export function fileIdsInUse(db: Database.Database): Set<string> {
  const usedFileIds = new Set<string>();

  // Check metadata for fileId and attachments
  const metaRows = db.prepare('SELECT metadata FROM messages WHERE metadata IS NOT NULL AND deleted_at IS NULL').all() as Array<{ metadata: string }>;
  for (const row of metaRows) {
    try {
      const meta = JSON.parse(row.metadata);
      if (meta.fileId) usedFileIds.add(meta.fileId);
      if (Array.isArray(meta.attachments)) {
        for (const att of meta.attachments) {
          if (att && typeof att === 'object' && typeof att.fileId === 'string') usedFileIds.add(att.fileId);
        }
      }
    } catch { /* skip malformed metadata */ }
  }

  // Also scan message content for links to a stored file. Two spellings count:
  // /api/files/<id> (a link the phone or a reply made) and data/files/<id> (the
  // path the Inbox app hands them to paste).
  const contentRows = db.prepare('SELECT content FROM messages WHERE content IS NOT NULL AND deleted_at IS NULL').all() as Array<{ content: string }>;
  for (const row of contentRows) addLinkedIds(row.content, usedFileIds);

  // The memory walls name files too (a report they dropped in, kept on a wall
  // by its path), and a wall is read every session, so what it names stays.
  // An artifact's code can show stored pictures, and Cortex's local copy
  // of a memory can name a file they kept. Both are read like a message.
  for (const table of ['artifacts:code', 'cortex_memory_embeddings:content']) {
    const [name, col] = table.split(':');
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)) continue;
    for (const row of db.prepare(`SELECT ${col} AS text FROM ${name} WHERE ${col} IS NOT NULL`).all() as Array<{ text: string }>) {
      if (typeof row.text === 'string') addLinkedIds(row.text, usedFileIds);
    }
  }

  // The table is made the first time memory is touched, so a house that has
  // never opened it has none, which is not an error.
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_blocks'").get()) {
    for (const row of db.prepare('SELECT content FROM memory_blocks WHERE content IS NOT NULL').all() as Array<{ content: string }>) {
      addLinkedIds(row.content, usedFileIds);
    }
  }

  // Preserve Press originals and the currently selected rendered previews.
  const pressRows = db.prepare(`
    SELECT source_file_id, rendered_file_id FROM press_assets
  `).all() as Array<{ source_file_id: string; rendered_file_id: string | null }>;
  for (const row of pressRows) {
    usedFileIds.add(row.source_file_id);
    if (row.rendered_file_id) usedFileIds.add(row.rendered_file_id);
  }
  const pressScenes = db.prepare('SELECT scene_json FROM press_spreads').all() as Array<{ scene_json: string }>;
  for (const row of pressScenes) {
    try {
      const scene = JSON.parse(row.scene_json) as { files?: Record<string, { storageFileId?: string; sourceFileId?: string }> };
      for (const ref of Object.values(scene.files || {})) {
        if (typeof ref.storageFileId === 'string') usedFileIds.add(ref.storageFileId);
        if (typeof ref.sourceFileId === 'string') usedFileIds.add(ref.sourceFileId);
      }
    } catch { /* skip malformed legacy scenes */ }
  }
  const pressPackRows = db.prepare(`
    SELECT source_file_id FROM press_pack_items WHERE source_file_id IS NOT NULL
  `).all() as Array<{ source_file_id: string }>;
  for (const row of pressPackRows) usedFileIds.add(row.source_file_id);
  const pressPackSources = db.prepare(`
    SELECT source_file_id FROM press_packs WHERE source_file_id IS NOT NULL
  `).all() as Array<{ source_file_id: string }>;
  for (const row of pressPackSources) usedFileIds.add(row.source_file_id);

  for (const row of db.prepare('SELECT file_id FROM message_tts WHERE file_id IS NOT NULL').all() as Array<{ file_id: string }>) usedFileIds.add(row.file_id);
  for (const row of db.prepare('SELECT file_id FROM thresholds WHERE file_id IS NOT NULL').all() as Array<{ file_id: string }>) usedFileIds.add(row.file_id);
  for (const row of db.prepare('SELECT thumbnail_file_id FROM press_spreads WHERE thumbnail_file_id IS NOT NULL').all() as Array<{ thumbnail_file_id: string }>) usedFileIds.add(row.thumbnail_file_id);
  // Their sound shelf on the Toys page (services/toy-sounds.ts). The table only
  // exists once the shelf has been opened, so its absence is not an error.
  const hasSounds = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'toy_sounds'").get();
  if (hasSounds) {
    for (const row of db.prepare('SELECT file_id FROM toy_sounds').all() as Array<{ file_id: string }>) usedFileIds.add(row.file_id);
  }

  // The phone's settings (config.app_settings) link to pictures in the file
  // store: wallpapers moved out of the blob once carrying them inline had it
  // at megabytes and every tap in Settings sent all of it back. Any link
  // anywhere in it counts.
  const settingsRow = db.prepare("SELECT value FROM config WHERE key = 'app_settings'").get() as { value: string } | undefined;
  if (settingsRow?.value) {
    for (const match of settingsRow.value.matchAll(/\/api\/files\/([a-f0-9-]{36})/gi)) usedFileIds.add(match[1]);
  }
  return usedFileIds;
}
