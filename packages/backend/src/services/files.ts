// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, extname } from 'path';
import crypto from 'crypto';
import { PROJECT_ROOT } from '../config.js';
import { NAME_SIDECAR_EXT, displayFilename, isNameSidecar, safeDisplayName, isGenericUploadName } from './file-names.js';

const FILES_DIR = join(PROJECT_ROOT, 'data/files');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'audio/webm': '.webm',
  'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a',
  // Films. A film used to come through as a zip because this list had no
  // video in it. mp4 only: every film we make is mp4, and a .webm is already
  // claimed by audio just above.
  'video/mp4': '.mp4',
  'application/pdf': '.pdf', 'text/plain': '.txt', 'text/markdown': '.md',
  'text/csv': '.csv', 'application/json': '.json',
  'application/zip': '.zip', 'application/x-zip-compressed': '.zip',
  'application/x-photoshop-brush': '.abr',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/msword': '.doc', 'application/vnd.ms-excel': '.xls',
};

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4', '.webm': 'audio/webm',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf', '.txt': 'text/plain',
  '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json',
  '.zip': 'application/zip',
  '.abr': 'application/x-photoshop-brush',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.doc': 'application/msword', '.xls': 'application/vnd.ms-excel',
};

export interface FileMetadata {
  fileId: string;
  filename: string;
  mimeType: string;
  size: number;
  contentType: 'image' | 'audio' | 'file';
  url: string;
}

export function getContentTypeFromMime(mimeType: string): 'image' | 'audio' | 'file' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

export function ensureFilesDir(): void {
  if (!existsSync(FILES_DIR)) mkdirSync(FILES_DIR, { recursive: true });
}

/** Whether the file door takes this type at all. */
export function isAllowedMime(mimeType: string): boolean {
  return !!ALLOWED_TYPES[mimeType];
}

export function resolveMimeType(originalFilename: string, browserMime: string): string {
  if (browserMime && browserMime !== 'application/octet-stream' && ALLOWED_TYPES[browserMime]) return browserMime;
  const ext = extname(originalFilename).toLowerCase();
  return EXT_TO_MIME[ext] || browserMime;
}


// The name the user gave a file is kept in a sidecar beside it — see file-names.ts
// for why a sidecar rather than a table, and for the sanitising rules.

function sidecarPath(fileId: string): string {
  return join(FILES_DIR, `${fileId}${NAME_SIDECAR_EXT}`);
}

/** Never let a save fail because a sidecar could not be written. */
function rememberFilename(fileId: string, originalFilename: string): void {
  // A camera default tells the user nothing about which file this is, and every
  // photo off the phone is called image.jpg. Remembering those would trade a
  // column of distinct hex for a column of identical words.
  if (isGenericUploadName(originalFilename)) return;
  const safe = safeDisplayName(originalFilename);
  if (!safe) return;
  try {
    writeFileSync(sidecarPath(fileId), safe, 'utf8');
  } catch {}
}

function rememberedFilename(fileId: string): string | null {
  try {
    return safeDisplayName(readFileSync(sidecarPath(fileId), 'utf8')) || null;
  } catch {
    return null;
  }
}

function forgetFilename(fileId: string): void {
  try {
    if (existsSync(sidecarPath(fileId))) unlinkSync(sidecarPath(fileId));
  } catch {}
}

export function saveFile(buffer: Buffer, originalFilename: string, mimeType: string): FileMetadata {
  if (buffer.length > MAX_FILE_SIZE) throw new Error(`File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`);
  mimeType = resolveMimeType(originalFilename, mimeType);
  if (!isAllowedMime(mimeType)) throw new Error(`File type ${mimeType} not allowed`);
  ensureFilesDir();
  const fileId = crypto.randomUUID();
  const ext = ALLOWED_TYPES[mimeType];
  writeFileSync(join(FILES_DIR, `${fileId}${ext}`), buffer);
  rememberFilename(fileId, originalFilename);
  return { fileId, filename: originalFilename, mimeType, size: buffer.length, contentType: getContentTypeFromMime(mimeType), url: `/api/files/${fileId}` };
}

export function getFile(fileId: string): { path: string; mimeType: string; filename: string } | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId)) return null;
  for (const [mime, ext] of Object.entries(ALLOWED_TYPES)) {
    const filePath = join(FILES_DIR, `${fileId}${ext}`);
    if (existsSync(filePath)) {
      return { path: filePath, mimeType: mime, filename: displayFilename(rememberedFilename(fileId), `${fileId}${ext}`) };
    }
  }
  return null;
}

/**
 * Squeeze a name into something safe to sit inside a Content-Disposition
 * header — quotes and control characters would terminate it early, and
 * non-ASCII needs the RFC 5987 form nobody here needs yet.
 */
export function attachmentFilename(name: string): string {
  const cleaned = name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned || 'download';
}

export interface FileListEntry {
  fileId: string; filename: string; mimeType: string; size: number;
  contentType: 'image' | 'audio' | 'file'; createdAt: string;
}

export function deleteFile(fileId: string): boolean {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId)) return false;
  for (const ext of Object.values(ALLOWED_TYPES)) {
    const filePath = join(FILES_DIR, `${fileId}${ext}`);
    if (existsSync(filePath)) { unlinkSync(filePath); forgetFilename(fileId); return true; }
  }
  return false;
}

// When a file was made. A copy that keeps the modified time (moving the house
// to a new server, say) gives every file a fresh birth time and its old
// modified time, so the earlier of the two is the real one; an edit after the
// fact only ever moves the modified time later. A filesystem with no birth
// time reports zero, which is not a date.
export function fileBornAt(stat: { birthtimeMs: number; mtimeMs: number }): string {
  const times = [stat.birthtimeMs, stat.mtimeMs].filter((t) => Number.isFinite(t) && t > 0);
  return new Date(times.length ? Math.min(...times) : 0).toISOString();
}

export function listFiles(): FileListEntry[] {
  ensureFilesDir();
  const entries: FileListEntry[] = [];
  const extToMime: Record<string, string> = {};
  for (const [mime, ext] of Object.entries(ALLOWED_TYPES)) extToMime[ext] = mime;
  const uuidRegex = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\.\w+)$/i;
  for (const file of readdirSync(FILES_DIR)) {
    const match = file.match(uuidRegex);
    if (!match) continue;
    // A sidecar matches the uuid pattern too — listing it would put a phantom
    // entry beside every named file in the Files app.
    if (isNameSidecar(match[2])) continue;
    const mimeType = extToMime[match[2]] || 'application/octet-stream';
    try {
      const stat = statSync(join(FILES_DIR, file));
      entries.push({ fileId: match[1], filename: displayFilename(rememberedFilename(match[1]), file), mimeType, size: stat.size, contentType: getContentTypeFromMime(mimeType), createdAt: fileBornAt(stat) });
    } catch {}
  }
  entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return entries;
}

export function saveFileInternal(buffer: Buffer, originalFilename: string): FileMetadata {
  if (buffer.length > MAX_FILE_SIZE) throw new Error(`File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`);
  ensureFilesDir();
  const ext = extname(originalFilename).toLowerCase();
  const mimeType = EXT_TO_MIME[ext] || 'application/octet-stream';
  const fileId = crypto.randomUUID();
  const storedExt = ALLOWED_TYPES[mimeType] || ext || '.bin';
  writeFileSync(join(FILES_DIR, `${fileId}${storedExt}`), buffer);
  rememberFilename(fileId, originalFilename);
  return { fileId, filename: originalFilename, mimeType, size: buffer.length, contentType: getContentTypeFromMime(mimeType), url: `/api/files/${fileId}` };
}

export function savePressSourceFile(buffer: Buffer, originalFilename: string): FileMetadata {
  const maxSize = 50 * 1024 * 1024;
  if (buffer.length > maxSize) throw new Error('Press source exceeds 50MB limit');
  if (extname(originalFilename).toLowerCase() !== '.abr') throw new Error('Only .abr source files use this Press doorway');
  ensureFilesDir();
  const fileId = crypto.randomUUID();
  const mimeType = 'application/x-photoshop-brush';
  writeFileSync(join(FILES_DIR, `${fileId}.abr`), buffer);
  rememberFilename(fileId, originalFilename);
  return {
    fileId,
    filename: originalFilename,
    mimeType,
    size: buffer.length,
    contentType: 'file',
    url: `/api/files/${fileId}`,
  };
}

export function saveFileFromBase64(base64Data: string, mimeType: string, filename: string): FileMetadata {
  return saveFile(Buffer.from(base64Data, 'base64'), filename, mimeType);
}
