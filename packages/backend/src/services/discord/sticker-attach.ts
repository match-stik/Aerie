// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Our ::pack_sticker:: tokens, sent to Discord as the sticker itself. The
// phone draws the token as a picture; Discord only ever printed the words. So on the way out
// each token we can resolve comes off the text and rides the message as a small
// copy of the sticker. That copy is the fallback now: a phone draws any
// attached picture as wide as the bubble, so a sticker goes out as one of the
// bot's own emojis when one can be made (app-emojis.ts), on a heading line of
// its own under the words that carried it. The stored sticker is never touched.
// A token we cannot resolve stays as it was written.

import { existsSync, readFileSync } from 'fs';
import { extname, join } from 'path';
import { AttachmentBuilder } from 'discord.js';
import { getDb } from '../db/state.js';
import { getStickersDir } from '../sticker-admin.js';

/** The same token the phone draws (MessageBubble.tsx): ::<pack>_<name>::. */
export const STICKER_REF_REGEX = /::([a-zA-Z0-9_-]+_[a-zA-Z0-9_-]+)::/g;

/** The longest side of the copy sent to Discord, in pixels. */
export const DISCORD_STICKER_PX = 160;

export interface StickerFile { ref: string; path: string; filename: string }

/** The stored file a ref names, or null. A pack name may itself hold an
 *  underscore, so every split point is tried, first underscore first. */
export function resolveStickerRef(ref: string, dir: string = getStickersDir()): StickerFile | null {
  const stmt = getDb().prepare(`
    SELECT s.pack_id AS packId, s.filename AS filename
    FROM stickers s JOIN sticker_packs p ON p.id = s.pack_id
    WHERE p.name = ? AND s.name = ?
  `);
  for (let i = ref.indexOf('_'); i > 0; i = ref.indexOf('_', i + 1)) {
    const row = stmt.get(ref.slice(0, i), ref.slice(i + 1)) as { packId: string; filename: string } | undefined;
    if (!row) continue;
    const path = join(dir, row.packId, row.filename);
    if (existsSync(path)) return { ref, path, filename: row.filename };
  }
  return null;
}

/** The words with the resolved tokens taken out: a line that held only
 *  stickers goes away, and nothing else about the text changes. */
export function stripStickerRefs(text: string, resolved: Set<string>): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    let had = false;
    const kept = line.replace(STICKER_REF_REGEX, (match, ref: string) => {
      if (!resolved.has(ref)) return match;
      had = true;
      return '';
    });
    if (had && kept.trim() === '') continue;
    out.push(had ? kept.replace(/ {2,}/g, ' ').trimEnd() : kept);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A small copy of a sticker, animation kept. Falls back to the stored file if
 *  the shrink fails, so a sticker still arrives. */
async function smallCopy(path: string): Promise<{ data: Buffer; ext: string }> {
  try {
    const sharp = (await import('sharp')).default;
    const data = await sharp(path, { animated: true })
      .resize(DISCORD_STICKER_PX, DISCORD_STICKER_PX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer();
    return { data, ext: '.webp' };
  } catch (err) {
    console.warn(`[Discord] Could not shrink sticker ${path}, sending it full size:`, (err as Error).message);
    return { data: readFileSync(path), ext: extname(path) || '.webp' };
  }
}

export interface ParsedStickers {
  text: string;
  /** Stickers that go out as pictures on the message (the fallback when the
   *  bot cannot make one its own emoji). */
  files: AttachmentBuilder[];
}

/** Our stickers as the bot's emojis, each on a line of its own under the words
 *  that carried it, as a one-hash heading. A heading draws an emoji bigger than a word, and the
 *  sticker stays under the voice that sent it. Tokens in `emojis` become the
 *  heading; tokens in `dropped` (sent as pictures instead) just leave the
 *  words; any other token stays as written. */
export function placeStickerEmojis(text: string, emojis: Map<string, string>, dropped: Set<string> = new Set()): string {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const heading: string[] = [];
    let touched = false;
    const kept = line.replace(STICKER_REF_REGEX, (match, ref: string) => {
      const token = emojis.get(ref);
      if (token) {
        heading.push(token);
        touched = true;
        return '';
      }
      if (dropped.has(ref)) {
        touched = true;
        return '';
      }
      return match;
    });
    if (!touched) {
      out.push(line);
      continue;
    }
    const words = kept.replace(/ {2,}/g, ' ').trim();
    if (words) out.push(words);
    if (heading.length > 0) out.push(`# ${heading.join(' ')}`);
  }
  const placed = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // A message that is nothing but emojis is drawn at Discord's biggest emoji
  // size on its own, and the heading would make them smaller than that, so an
  // all-emoji reply goes out bare. Discord only does this for thirty or fewer.
  const lines = placed.split('\n').filter((l) => l.trim());
  const allEmoji = lines.length > 0 && lines.every((l) => l.startsWith('# ') && /^(<a?:\w+:\d+>\s*)+$/.test(l.slice(2).trim()));
  const count = allEmoji ? (placed.match(/<a?:\w+:\d+>/g) ?? []).length : 0;
  if (allEmoji && count <= 30) return lines.map((l) => l.slice(2).trim()).join('\n');
  return placed;
}

/** Turn every resolvable sticker token in a reply into one of the bot's
 *  emojis when emojiFor can make one, placed as a heading line under its words,
 *  and otherwise into a small attached picture; a token nobody can resolve
 *  stays as written. */
export async function parseStickerRefs(
  response: string,
  dir?: string,
  emojiFor?: (file: StickerFile) => Promise<string | null>,
): Promise<ParsedStickers> {
  const found: StickerFile[] = [];
  for (const match of response.matchAll(STICKER_REF_REGEX)) {
    const ref = match[1];
    if (found.some((f) => f.ref === ref)) continue;
    const file = resolveStickerRef(ref, dir);
    if (file) found.push(file);
  }
  if (found.length === 0) return { text: response, files: [] };
  const files: AttachmentBuilder[] = [];
  const emojis = new Map<string, string>();
  const dropped = new Set<string>();
  for (const file of found) {
    const token = emojiFor ? await emojiFor(file).catch(() => null) : null;
    if (token) {
      emojis.set(file.ref, token);
      continue;
    }
    const copy = await smallCopy(file.path);
    files.push(new AttachmentBuilder(copy.data, { name: `${file.ref}${copy.ext}` }));
    dropped.add(file.ref);
  }
  return { text: placeStickerEmojis(response, emojis, dropped), files };
}
