// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Our sticker tokens go to Discord as a small picture of the sticker, and the
// words lose the token; a token nobody can resolve is left as written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { loadConfig } = await import('../../config.js');
loadConfig();

const { initDb } = await import('../db/init.js');
const { getDb } = await import('../db/state.js');
const { default: sharp } = await import('sharp');
const { resolveStickerRef, stripStickerRefs, parseStickerRefs, placeStickerEmojis, DISCORD_STICKER_PX } = await import('./sticker-attach.js');

async function freshHouse(): Promise<string> {
  initDb(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'sticker-attach-'));
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare('INSERT INTO sticker_packs (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'cedar', now, now);
  db.prepare('INSERT INTO sticker_packs (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p2', 'big_pack', now, now);
  mkdirSync(join(dir, 'p1'));
  mkdirSync(join(dir, 'p2'));
  const png = await sharp({ create: { width: 512, height: 400, channels: 4, background: { r: 200, g: 100, b: 50, alpha: 1 } } }).png().toBuffer();
  writeFileSync(join(dir, 'p1', 'side.png'), png);
  writeFileSync(join(dir, 'p2', 'wave.png'), png);
  db.prepare('INSERT INTO stickers (id, pack_id, name, filename, created_at) VALUES (?, ?, ?, ?, ?)').run('s1', 'p1', 'coffeesideeye', 'side.png', now);
  db.prepare('INSERT INTO stickers (id, pack_id, name, filename, created_at) VALUES (?, ?, ?, ?, ?)').run('s2', 'p2', 'wave', 'wave.png', now);
  return dir;
}

test('a ref resolves to its stored file, a pack name with an underscore included', async () => {
  const dir = await freshHouse();
  assert.equal(resolveStickerRef('cedar_coffeesideeye', dir)?.path, join(dir, 'p1', 'side.png'));
  assert.equal(resolveStickerRef('big_pack_wave', dir)?.path, join(dir, 'p2', 'wave.png'));
  assert.equal(resolveStickerRef('cedar_nosuchthing', dir), null);
});

test('a line that held only a sticker goes away, and an unknown token stays', () => {
  const text = '**✨ Cedar**\nManners, love.\n::cedar_coffeesideeye::\n\n**🌫️ Willow**\nHe says that ::cedar_coffeesideeye:: like ::willow_unknown:: so.';
  assert.equal(
    stripStickerRefs(text, new Set(['cedar_coffeesideeye'])),
    '**✨ Cedar**\nManners, love.\n\n**🌫️ Willow**\nHe says that like ::willow_unknown:: so.',
  );
});

test('the sticker rides the message as a small copy, and the words lose the token', async () => {
  const dir = await freshHouse();
  const out = await parseStickerRefs('Manners, love.\n::cedar_coffeesideeye::\n::cedar_nope::', dir);
  assert.equal(out.text, 'Manners, love.\n::cedar_nope::');
  assert.equal(out.files.length, 1);
  assert.equal(out.files[0].name, 'cedar_coffeesideeye.webp');
  const meta = await sharp(out.files[0].attachment as Buffer).metadata();
  assert.equal(meta.format, 'webp');
  assert.ok((meta.width ?? 0) <= DISCORD_STICKER_PX && (meta.height ?? 0) <= DISCORD_STICKER_PX, `${meta.width}x${meta.height}`);
});

test('a reply with no sticker in it is handed back untouched', async () => {
  const dir = await freshHouse();
  const out = await parseStickerRefs('Just words :smile: here', dir);
  assert.deepEqual(out, { text: 'Just words :smile: here', files: [] });
});

test('a sticker the bot has as an emoji lands as a one-hash heading under its own words, and the rest as pictures', async () => {
  const dir = await freshHouse();
  const out = await parseStickerRefs(
    '**✨ Cedar**\nManners.\n::cedar_coffeesideeye::\n\n**🔥 Birch**\nMine ::big_pack_wave:: too.',
    dir,
    async (file) => (file.ref === 'cedar_coffeesideeye' ? '<:cedar_coffeesideeye:7>' : null),
  );
  assert.equal(out.text, '**✨ Cedar**\nManners.\n# <:cedar_coffeesideeye:7>\n\n**🔥 Birch**\nMine too.');
  assert.equal(out.files.length, 1);
  assert.equal(out.files[0].name, 'big_pack_wave.webp');
});

test('a sticker written inside a sentence moves to its own heading line right after it', () => {
  const emojis = new Map([['cedar_coffeesideeye', '<:cedar_coffeesideeye:7>'], ['birch_bear', '<:birch_bear:8>']]);
  assert.equal(
    placeStickerEmojis('Look ::cedar_coffeesideeye:: at this ::birch_bear::\nNext line ::willow_unknown::', emojis),
    'Look at this\n# <:cedar_coffeesideeye:7> <:birch_bear:8>\nNext line ::willow_unknown::',
  );
});

test('a reply of nothing but stickers goes out bare, so Discord draws them at full emoji size', () => {
  const emojis = new Map([['cedar_coffeesideeye', '<:cedar_coffeesideeye:7>'], ['birch_bear', '<a:birch_bear:8>']]);
  assert.equal(placeStickerEmojis('::cedar_coffeesideeye:: ::birch_bear::', emojis), '<:cedar_coffeesideeye:7> <a:birch_bear:8>');
  // Words anywhere keep the heading.
  assert.equal(placeStickerEmojis('**Willow**\n::birch_bear::', emojis), '**Willow**\n# <a:birch_bear:8>');
  // Past thirty Discord draws them small anyway, so the heading stays.
  const many = Array.from({ length: 31 }, () => '::birch_bear::').join(' ');
  assert.ok(placeStickerEmojis(many, emojis).startsWith('# '));
});
