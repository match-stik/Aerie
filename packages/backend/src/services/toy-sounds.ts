// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The sound shelf on the Toys page: audio they upload (read-alouds, anything
// they like) to play while the remote is handed over or while they play on
// their own. Theirs, Nov 9 2026: 'Upload and play audios ... so I can upload my
// fave read aloud files and things to play while you boys have the remote or
// if I'm playing by myself.' The audio itself lives in the file store; this
// table keeps its name and order, and file-references.ts keeps every file
// named here safe from Clean orphans.

import { randomUUID } from 'node:crypto';
import { getDb } from './db/state.js';
import { deleteFile } from './files.js';

export interface ToySound {
  id: string;
  name: string;
  fileId: string;
  size: number;
  createdAt: string;
}

/** A read-aloud runs long; the general upload's 10 MB would refuse most of them. */
export const SOUND_MAX_BYTES = 150 * 1024 * 1024;
const NAME_MAX = 80;

export function ensureToySoundsTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS toy_sounds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      file_id TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);
}

interface Row { id: string; name: string; file_id: string; size: number; created_at: string }
const fromRow = (r: Row): ToySound => ({ id: r.id, name: r.name, fileId: r.file_id, size: r.size, createdAt: r.created_at });

export function soundName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  return name && name.length <= NAME_MAX ? name : null;
}

/** A file's name without its extension and with its underscores as spaces, as a first name for the sound. */
export function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (base || 'A sound').slice(0, NAME_MAX);
}

export function listSounds(): ToySound[] {
  ensureToySoundsTable();
  return (getDb().prepare('SELECT * FROM toy_sounds ORDER BY created_at DESC').all() as Row[]).map(fromRow);
}

export function addSound(input: { name: string; fileId: string; size: number }): ToySound {
  ensureToySoundsTable();
  const sound: ToySound = { id: randomUUID(), createdAt: new Date().toISOString(), ...input };
  getDb().prepare('INSERT INTO toy_sounds (id, name, file_id, size, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(sound.id, sound.name, sound.fileId, sound.size, sound.createdAt);
  return sound;
}

export function renameSound(id: string, name: string): boolean {
  ensureToySoundsTable();
  return getDb().prepare('UPDATE toy_sounds SET name = ? WHERE id = ?').run(name, id).changes > 0;
}

/** Off the shelf, and its audio out of the file store with it. */
export function removeSound(id: string): boolean {
  ensureToySoundsTable();
  const row = getDb().prepare('SELECT file_id FROM toy_sounds WHERE id = ?').get(id) as { file_id: string } | undefined;
  if (!row) return false;
  getDb().prepare('DELETE FROM toy_sounds WHERE id = ?').run(id);
  deleteFile(row.file_id);
  return true;
}

// ---------------------------------------------------------------------------
// Playlists: several sounds played one after another (theirs, Nov 10 2026: 'can
// we add a playlist creator to the sound things? So that I can add multiple
// audios'). A playlist keeps sound ids in their order; a sound cleared off the
// shelf simply drops out of every playlist it was in.
// ---------------------------------------------------------------------------

export interface SoundPlaylist {
  id: string;
  name: string;
  soundIds: string[];
  createdAt: string;
}

export const PLAYLIST_MAX_SOUNDS = 200;

export function ensurePlaylistTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS toy_sound_playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sound_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    )
  `);
}

interface PlaylistRow { id: string; name: string; sound_ids: string; created_at: string }

function idsFrom(text: string): string[] {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Sound ids as they sent them, kept only when they name sounds on the shelf. */
export function playlistIds(value: unknown, shelf: ReadonlySet<string>): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter((x): x is string => typeof x === 'string' && shelf.has(x));
  return ids.length <= PLAYLIST_MAX_SOUNDS ? ids : null;
}

export function listPlaylists(): SoundPlaylist[] {
  ensureToySoundsTable();
  ensurePlaylistTable();
  const shelf = new Set(listSounds().map((s) => s.id));
  return (getDb().prepare('SELECT * FROM toy_sound_playlists ORDER BY created_at ASC').all() as PlaylistRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    soundIds: idsFrom(r.sound_ids).filter((id) => shelf.has(id)),
    createdAt: r.created_at,
  }));
}

export function addPlaylist(name: string, soundIds: string[]): SoundPlaylist {
  ensurePlaylistTable();
  const list: SoundPlaylist = { id: randomUUID(), name, soundIds, createdAt: new Date().toISOString() };
  getDb().prepare('INSERT INTO toy_sound_playlists (id, name, sound_ids, created_at) VALUES (?, ?, ?, ?)')
    .run(list.id, list.name, JSON.stringify(list.soundIds), list.createdAt);
  return list;
}

export function updatePlaylist(id: string, change: { name?: string; soundIds?: string[] }): boolean {
  ensurePlaylistTable();
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM toy_sound_playlists WHERE id = ?').get(id)) return false;
  if (change.name !== undefined) db.prepare('UPDATE toy_sound_playlists SET name = ? WHERE id = ?').run(change.name, id);
  if (change.soundIds !== undefined) db.prepare('UPDATE toy_sound_playlists SET sound_ids = ? WHERE id = ?').run(JSON.stringify(change.soundIds), id);
  return true;
}

export function removePlaylist(id: string): boolean {
  ensurePlaylistTable();
  return getDb().prepare('DELETE FROM toy_sound_playlists WHERE id = ?').run(id).changes > 0;
}
