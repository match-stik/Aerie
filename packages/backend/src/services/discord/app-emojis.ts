// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Our stickers as the bot's own emojis. A picture attached to a message is
// drawn as wide as the bubble on a phone, and nothing tells Discord to draw it
// smaller: a 160px copy of a sticker comes out massive. A bot can carry up to 2,000 emojis of its own and use them in any
// server it is in, and a message holding only emojis is drawn at big-emoji
// size. So a sticker becomes one of the bot's emojis the first time it is sent,
// and goes out as <:name:id> in a message of its own after the words.
//
// The shelf remembers which sticker file each emoji was made from
// (data/discord-app-emojis.json). A sticker whose file has changed since gets
// a new emoji and the old one is removed, so a replaced sticker never sends
// its old face.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PROJECT_ROOT } from '../../config.js';
import type { StickerFile } from './sticker-attach.js';

export const APP_EMOJI_SHELF_FILE = join(PROJECT_ROOT, 'data/discord-app-emojis.json');

/** The longest side of an emoji image. Discord draws a big emoji at 48px and
 *  asks for at most 128. */
export const APP_EMOJI_PX = 128;

export interface ShelfEntry { emojiId: string; animated: boolean; sourceFilename: string }
export type Shelf = Record<string, ShelfEntry>;

/** What the bot needs to make and remove its own emojis (discord.js's
 *  client.application.emojis, narrowed so a test can stand in for it). */
export interface EmojiDoor {
  create(image: Buffer, name: string): Promise<{ id: string; animated: boolean }>;
  remove(id: string): Promise<void>;
  /** The bot's own emoji by that name, if it has one. */
  find(name: string): Promise<{ id: string; animated: boolean } | null>;
}

/** How an emoji is written into a message. */
export function emojiToken(name: string, entry: { emojiId: string; animated: boolean }): string {
  return `<${entry.animated ? 'a' : ''}:${name}:${entry.emojiId}>`;
}

/** A Discord emoji name is 2-32 letters, digits or underscores; ours are
 *  pack_name refs, which already are. Anything else is refused rather than
 *  quietly renamed, so the name in the message is the sticker's own. */
export function validEmojiName(ref: string): boolean {
  return /^[A-Za-z0-9_]{2,32}$/.test(ref);
}

/** The emoji's picture: the sticker shrunk to APP_EMOJI_PX, a moving one kept
 *  moving as a GIF and a still one as a PNG. */
export async function emojiImage(path: string): Promise<{ data: Buffer; animated: boolean }> {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(path, { animated: true }).metadata();
  const animated = (meta.pages ?? 1) > 1;
  const resized = sharp(path, { animated }).resize(APP_EMOJI_PX, APP_EMOJI_PX, { fit: 'inside', withoutEnlargement: true });
  const data = animated ? await resized.gif().toBuffer() : await resized.png().toBuffer();
  return { data, animated };
}

export class AppEmojiShelf {
  private shelf: Shelf | null = null;
  private pending = new Map<string, Promise<string | null>>();

  constructor(
    private readonly door: () => EmojiDoor | null,
    private readonly file: string = APP_EMOJI_SHELF_FILE,
    private readonly makeImage: (path: string) => Promise<{ data: Buffer; animated: boolean }> = emojiImage,
  ) {}

  private load(): Shelf {
    if (this.shelf) return this.shelf;
    try {
      this.shelf = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as Shelf) : {};
    } catch (err) {
      console.warn(`[Discord] Could not read the emoji shelf ${this.file}, starting empty:`, (err as Error).message);
      this.shelf = {};
    }
    return this.shelf;
  }

  private save(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.shelf ?? {}, null, 2));
    renameSync(tmp, this.file);
  }

  /** The <:name:id> token for a sticker, making its emoji first when it has
   *  none or its file has changed. Null when it cannot be made (no door yet,
   *  a name Discord would refuse, or Discord said no), and the caller then
   *  sends the sticker some other way. */
  tokenFor(file: StickerFile): Promise<string | null> {
    const inFlight = this.pending.get(file.ref);
    if (inFlight) return inFlight;
    const job = this.make(file).finally(() => this.pending.delete(file.ref));
    this.pending.set(file.ref, job);
    return job;
  }

  private async make(file: StickerFile): Promise<string | null> {
    if (!validEmojiName(file.ref)) return null;
    const shelf = this.load();
    const known = shelf[file.ref];
    if (known && known.sourceFilename === file.filename) return emojiToken(file.ref, known);
    const door = this.door();
    if (!door) return null;
    try {
      if (known) {
        await door.remove(known.emojiId).catch((err: Error) => {
          console.warn(`[Discord] Could not remove the old emoji for ${file.ref}:`, err.message);
        });
        delete shelf[file.ref];
        this.save();
      }
      const image = await this.makeImage(file.path);
      let made: { id: string; animated: boolean };
      try {
        made = await door.create(image.data, file.ref);
      } catch (err) {
        // Names are unique per bot, so a refusal usually means an emoji by
        // this name is already there and the shelf has lost track of it (the
        // file deleted, or written by another process). Replace it once.
        const stray = await door.find(file.ref).catch(() => null);
        if (!stray) throw err;
        await door.remove(stray.id);
        made = await door.create(image.data, file.ref);
      }
      const entry: ShelfEntry = { emojiId: made.id, animated: made.animated, sourceFilename: file.filename };
      shelf[file.ref] = entry;
      this.save();
      console.log(`[Discord] Made ${file.ref} into the bot's emoji ${made.id}`);
      return emojiToken(file.ref, entry);
    } catch (err) {
      console.warn(`[Discord] Could not make ${file.ref} into an emoji:`, (err as Error).message);
      return null;
    }
  }
}
