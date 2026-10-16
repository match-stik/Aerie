// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// "Clean orphans" deletes every stored file that fileIdsInUse() does not name,
// so a table holding a file id that this list forgets has its files deleted
// out from under it. The first test is the fence: it finds every column on a
// fresh schema whose name says it holds a file and fails on one nobody has
// accounted for. The second proves the three found by an outside audit are kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const { loadConfig } = await import('../config.js');
const { initDb } = await import('./db/init.js');
const { getDb } = await import('./db.js');
const { fileIdsInUse } = await import('./file-references.js');

loadConfig(join(mkdtempSync(join(tmpdir(), 'file-refs-')), 'none.yaml'));
initDb(':memory:');

// Columns that name a stored file and are read by fileIdsInUse(), plus the
// ones that hold something else, each with the reason.
const COUNTED = new Set([
  'message_tts.file_id', 'thresholds.file_id',
  'press_spreads.thumbnail_file_id', 'press_assets.source_file_id', 'press_assets.rendered_file_id',
  'press_packs.source_file_id', 'press_pack_items.source_file_id',
]);
const NOT_A_STORED_FILE: Record<string, string> = {
  'stickers.filename': 'sticker art lives in its own folder, not the file store',
  'emojis.filename': 'emoji art lives in its own folder, not the file store',
  'artifacts.thumbnail': 'an inline preview, not a file id',
};

test('every column that holds a file is either kept by Clean orphans or explained', () => {
  const db = getDb();
  const unknown: string[] = [];
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>) {
    for (const { name: col } of db.prepare(`PRAGMA table_info('${name}')`).all() as Array<{ name: string }>) {
      if (!/file|audio|thumb/i.test(col)) continue;
      const key = `${name}.${col}`;
      if (!COUNTED.has(key) && !(key in NOT_A_STORED_FILE)) unknown.push(key);
    }
  }
  assert.deepEqual(unknown, [], 'a new column holds files; add it to fileIdsInUse() and to COUNTED');
});

test('read-aloud audio, voice notes left at places and Press thumbnails are kept', () => {
  const db = getDb();
  // Bare rows with no parents: only the file column is under test here.
  db.pragma('foreign_keys = OFF');
  const cols = (t: string) => (db.prepare(`PRAGMA table_info('${t}')`).all() as Array<{ name: string; notnull: number; dflt_value: unknown }>);
  const insert = (table: string, values: Record<string, unknown>) => {
    const row: Record<string, unknown> = {};
    for (const c of cols(table)) {
      if (c.name in values) row[c.name] = values[c.name];
      else if (c.notnull && c.dflt_value === null) row[c.name] = c.name.endsWith('_at') ? '2026-03-12T00:00:00Z' : (c.name === 'id' ? `${table}-1` : 'x');
    }
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => row[k]));
  };
  insert('message_tts', { file_id: 'tts-file' });
  insert('thresholds', { file_id: 'threshold-file' });
  insert('press_spreads', { thumbnail_file_id: 'press-thumb' });
  const kept = fileIdsInUse(db);
  for (const id of ['tts-file', 'threshold-file', 'press-thumb']) assert.ok(kept.has(id), id);
});

test('a picture the owner\'s settings point at is kept, wherever in the settings it sits', () => {
  const db = getDb();
  // Wallpapers moved out of the settings blob into the file store; the blob
  // keeps only links, so Clean orphans has to read it.
  const settings = {
    theme: {
      wallpaper: '/api/files/11111111-1111-4111-8111-111111111111',
      wallpapers: ['https://aerie.example/api/files/22222222-2222-4222-8222-222222222222'],
      modeWallpapers: { light: { lockScreenWallpaper: '/api/files/33333333-3333-4333-8333-333333333333' } },
    },
  };
  db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('app_settings', ?)").run(JSON.stringify(settings));
  const kept = fileIdsInUse(db);
  for (const id of [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
  ]) assert.ok(kept.has(id), id);
});
