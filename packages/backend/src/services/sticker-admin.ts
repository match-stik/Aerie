// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Sticker file management — handles storage on filesystem
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync, readdirSync } from 'fs';
import { join, basename, extname } from 'path';
import { PROJECT_ROOT } from '../config.js';

const STICKERS_DIR = join(PROJECT_ROOT, 'data/stickers');

export function ensureStickersDir(): void {
  if (!existsSync(STICKERS_DIR)) {
    mkdirSync(STICKERS_DIR, { recursive: true });
  }
}

export function ensurePackDir(packId: string): string {
  const packDir = join(STICKERS_DIR, packId);
  if (!existsSync(packDir)) {
    mkdirSync(packDir, { recursive: true });
  }
  return packDir;
}

export function getStickersDir(): string {
  ensureStickersDir();
  return STICKERS_DIR;
}

export function sanitizeStickerFilename(name: string): string {
  return basename(name)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 100);
}

export function extForSticker(mimetype: string): string {
  return mimetype === 'image/webp' ? '.webp'
    : mimetype === 'image/gif' ? '.gif' : '.png';
}

/**
 * EVERY sticker file gets a version token, because the url is built straight
 * off the filename. New bytes under a name that has been used before leave
 * every cache in the chain (browser, the phone's ref index, any proxy) serving
 * what it already has for an unchanged address.
 *
 * Replacements got the token first. Uploads did not — so delete-and-re-upload,
 * which was the only documented way to change a sticker's picture, put the
 * same name back and therefore landed on the same address every time. The row
 * was new, the bytes on disk were new, and the phone went on showing the old
 * drawing with nothing to explain it. A new filename is a new address, so the
 * screen cannot miss it.
 */
export function stickerFilenameFor(
  name: string,
  mimetype: string,
  version: string = Date.now().toString(36),
): string {
  const base = sanitizeStickerFilename(name);
  return `${base}-${version}${extForSticker(mimetype)}`;
}

export function writeStickerFile(packId: string, filename: string, buffer: Buffer): string {
  const packDir = ensurePackDir(packId);
  const safeName = sanitizeStickerFilename(filename);
  const filePath = join(packDir, safeName);
  writeFileSync(filePath, buffer);
  return safeName;
}

export function deleteStickerFile(packId: string, filename: string): boolean {
  const filePath = join(STICKERS_DIR, packId, filename);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
    return true;
  }
  return false;
}

export function deleteStickerPackFiles(packId: string): boolean {
  const packDir = join(STICKERS_DIR, packId);
  if (existsSync(packDir)) {
    rmSync(packDir, { recursive: true, force: true });
    return true;
  }
  return false;
}

export function listPackFiles(packId: string): string[] {
  const packDir = join(STICKERS_DIR, packId);
  if (!existsSync(packDir)) return [];
  return readdirSync(packDir).filter(f => {
    const ext = extname(f).toLowerCase();
    return ['.png', '.webp', '.gif'].includes(ext);
  });
}
