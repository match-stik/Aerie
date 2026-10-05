// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Helpers for embedding images directly into the model's input as content
// blocks instead of surfacing them via path-hints + Read tool. Used for
// sticker refs in chat and image attachments — so the companions actually SEE
// the visual, not just know its name.
//
// The Anthropic API accepts user messages with content as an array of
// blocks (text + image). The Claude Agent SDK passes these through when
// the prompt is provided as AsyncIterable<SDKUserMessage>.

import { existsSync, readFileSync, statSync } from 'fs';
import { extname, dirname, join } from 'path';
import { getStickerByRef } from './db/stickers.js';
import { getEmojiByName } from './db/emojis.js';
import { getAerieConfig, PROJECT_ROOT } from '../config.js';

// Resolve runtime data dirs from the same config the upload routes use
// (dirname of server.db_path). PROJECT_ROOT/data only happens to match
// when the user runs with the default db_path — anywhere else and the
// hardcoded path here misses, fileToImageBlock returns null, and the
// agent silently never receives the emoji or sticker as an image.
function dataDirForRuntime(): string {
  try {
    return dirname(getAerieConfig().server.db_path);
  } catch {
    return join(PROJECT_ROOT, 'data');
  }
}

export type ImageBlock = {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    data: string;
  };
};

// Hard cap on total image bytes per turn so a sticker-spam message can't
// blow up the context window. 25MB raw covers ~5 max-size screenshots
// (Anthropic accepts up to 5MB per image and downscales server-side) or a
// big sticker batch. With 1M context windows this is comfortably affordable.
const MAX_TOTAL_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGES_PER_TURN = 8;

const STICKER_REF_REGEX = /::([A-Za-z0-9_-]+)_([A-Za-z0-9_-]+)::/g;

function mediaTypeFromPath(filePath: string): ImageBlock['source']['media_type'] | null {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    default: return null;
  }
}

export function fileToImageBlock(filePath: string): ImageBlock | null {
  if (!filePath || !existsSync(filePath)) return null;
  const mediaType = mediaTypeFromPath(filePath);
  if (!mediaType) return null;
  try {
    const buf = readFileSync(filePath);
    return {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') },
    };
  } catch {
    return null;
  }
}

// Find every :PackName_StickerName: ref in a string and resolve to image
// blocks. Unknown refs and non-image sticker types are silently skipped.
export function stickerRefsToImageBlocks(text: string): ImageBlock[] {
  if (!text) return [];
  const out: ImageBlock[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  STICKER_REF_REGEX.lastIndex = 0;
  while ((match = STICKER_REF_REGEX.exec(text)) !== null) {
    const [full, packName, stickerName] = match;
    if (seen.has(full)) continue;
    seen.add(full);
    const sticker = getStickerByRef(packName, stickerName);
    if (!sticker) continue;
    // sticker-admin keeps files under PROJECT_ROOT/data/stickers (not the
    // config-derived data dir like emojis) — match that here.
    const path = join(PROJECT_ROOT, 'data', 'stickers', sticker.pack_id, sticker.filename);
    const block = fileToImageBlock(path);
    if (block) out.push(block);
  }
  return out;
}

const EMOJI_REF_REGEX = /(?<!:):([a-zA-Z0-9_]+):(?!:)/g;

// Find every :emoji_name: ref in a string and resolve to image blocks.
// Uses the emoji database; unknown refs are silently skipped.
export function emojiRefsToImageBlocks(text: string): ImageBlock[] {
  if (!text) return [];
  const out: ImageBlock[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  EMOJI_REF_REGEX.lastIndex = 0;
  while ((match = EMOJI_REF_REGEX.exec(text)) !== null) {
    const [full, emojiName] = match;
    if (seen.has(full)) continue;
    seen.add(full);
    const emoji = getEmojiByName(emojiName);
    if (!emoji) continue;
    const path = join(dataDirForRuntime(), 'emojis', emoji.filename);
    const block = fileToImageBlock(path);
    if (block) out.push(block);
  }
  return out;
}

// Returns emoji refs with their resolved paths for path hints
export function emojiRefsToPathHints(text: string): { ref: string; path: string }[] {
  if (!text) return [];
  const out: { ref: string; path: string }[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  EMOJI_REF_REGEX.lastIndex = 0;
  while ((match = EMOJI_REF_REGEX.exec(text)) !== null) {
    const [full, emojiName] = match;
    if (seen.has(full)) continue;
    seen.add(full);
    const emoji = getEmojiByName(emojiName);
    if (!emoji) continue;
    const path = join(dataDirForRuntime(), 'emojis', emoji.filename);
    out.push({ ref: full, path });
  }
  return out;
}

// Apply per-turn caps. Returns the slice that fits and a count of dropped images.
export function capImageBlocks(blocks: ImageBlock[]): { kept: ImageBlock[]; dropped: number } {
  if (blocks.length === 0) return { kept: [], dropped: 0 };
  const kept: ImageBlock[] = [];
  let bytes = 0;
  for (const b of blocks) {
    if (kept.length >= MAX_IMAGES_PER_TURN) break;
    // base64 is ~4/3 the size of raw bytes
    const approxBytes = Math.ceil((b.source.data.length * 3) / 4);
    if (bytes + approxBytes > MAX_TOTAL_IMAGE_BYTES) break;
    kept.push(b);
    bytes += approxBytes;
  }
  return { kept, dropped: blocks.length - kept.length };
}

// Convenience for ws/message.ts — given a list of image attachment paths,
// build blocks (existence + mime checks already in fileToImageBlock).
export function attachmentPathsToImageBlocks(paths: string[]): ImageBlock[] {
  const out: ImageBlock[] = [];
  for (const p of paths) {
    const block = fileToImageBlock(p);
    if (block) out.push(block);
  }
  return out;
}

// Sanity check used by tests / debug — not invoked by hot paths.
export function debugImageBlock(block: ImageBlock): { mediaType: string; bytes: number } {
  return {
    mediaType: block.source.media_type,
    bytes: Math.ceil((block.source.data.length * 3) / 4),
  };
}

// File-size guard for fileToImageBlock callers that want to skip huge files
// (e.g. a 5MB photo that would dominate the turn). Returns true if file is
// safe to embed.
export function isEmbeddableImage(filePath: string, maxBytes = 5 * 1024 * 1024): boolean {
  if (!filePath || !existsSync(filePath)) return false;
  if (!mediaTypeFromPath(filePath)) return false;
  try {
    return statSync(filePath).size <= maxBytes;
  } catch {
    return false;
  }
}

// Fetch an image from a URL and convert to ImageBlock
// Used for Discord CDN images, embeds, and other external sources
export async function urlToImageBlock(url: string): Promise<ImageBlock | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'image/gif,image/*' },
    });
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    let mediaType: ImageBlock['source']['media_type'] | null = null;

    if (contentType.includes('png')) mediaType = 'image/png';
    else if (contentType.includes('jpeg') || contentType.includes('jpg')) mediaType = 'image/jpeg';
    else if (contentType.includes('gif')) mediaType = 'image/gif';
    else if (contentType.includes('webp')) mediaType = 'image/webp';

    if (!mediaType) return null;

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    return {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: base64 },
    };
  } catch {
    return null;
  }
}

// Batch fetch multiple URLs, returning only successful fetches
export async function urlsToImageBlocks(urls: string[]): Promise<ImageBlock[]> {
  const results = await Promise.all(urls.map(urlToImageBlock));
  return results.filter((b): b is ImageBlock => b !== null);
}
