// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { promises as fs } from 'fs';
import { existsSync, readdirSync } from 'fs';
import { join, extname, basename } from 'path';
import crypto from 'crypto';
import { getConfig, setConfig } from '../db/config.js';
import { Drawer, IMAGE_EXTS, REFS_DIR, Subject, discoveredDrawers } from './settings.js';
import { ImageGenError } from './common.js';

export function slugifyDrawer(label: string): string {
  return String(label).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

export function sanitizeSlug(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
}

type CustomDrawer = { slug: string; label: string; emoji?: string };

function customDrawers(): CustomDrawer[] {
  const raw = getConfig('image_gen.drawers');
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr
          .filter((d) => d && typeof d.slug === 'string' && typeof d.label === 'string')
          .map((d) => ({ slug: d.slug, label: d.label, emoji: typeof d.emoji === 'string' && d.emoji ? d.emoji : undefined }))
      : [];
  } catch { return []; }
}

function setCustomDrawers(list: CustomDrawer[]): void {
  setConfig('image_gen.drawers', JSON.stringify(list));
}

function cleanEmoji(e: string | undefined): string | undefined {
  const v = String(e ?? '').trim();
  return v ? Array.from(v).slice(0, 2).join('') : undefined;
}

/**
 * A drawer nobody named: it exists because its directory does. These stay
 * protected from rename and delete, exactly as the old hardcoded four were.
 * Anything created through Studio lives in config and is their person's to change.
 */
function unnamedDrawers(customs: ReadonlyArray<CustomDrawer>): Array<{ slug: string; label: string }> {
  const named = new Set(customs.map((c) => c.slug));
  return discoveredDrawers().filter((d) => !named.has(d.slug));
}

export function listDrawers(): Drawer[] {
  const customs = customDrawers();
  return [
    ...unnamedDrawers(customs).map((d) => ({ ...d, isDefault: true })),
    ...customs.map((d) => ({ ...d, isDefault: false })),
  ];
}

export function isKnownDrawer(slug: string): boolean {
  return listDrawers().some((d) => d.slug === sanitizeSlug(slug));
}

export function listDrawersWithCounts(): Array<Drawer & { count: number }> {
  return listDrawers().map((d) => {
    let count = 0;
    try {
      const dir = join(REFS_DIR, d.slug);
      if (existsSync(dir)) count = readdirSync(dir).filter((f) => IMAGE_EXTS.has(extname(f).toLowerCase())).length;
    } catch { /* ignore */ }
    return { ...d, count };
  });
}

export function isSafeSubjectSlug(s: string): boolean {
  return Boolean(s) && sanitizeSlug(s) === s;
}

export function isValidSubject(s: string): boolean {
  return isSafeSubjectSlug(s) && isKnownDrawer(s);
}

export function createDrawer(label: string, emoji?: string): Drawer {
  const trimmed = String(label || '').trim();
  if (!trimmed) throw new ImageGenError('A name is required.');
  const slug = slugifyDrawer(trimmed);
  if (!slug) throw new ImageGenError('That name has no usable characters — try letters or numbers.');
  const existing = listDrawers().find((d) => d.slug === slug);
  if (existing) return existing;
  const e = cleanEmoji(emoji);
  const customs = customDrawers();
  customs.push({ slug, label: trimmed, emoji: e });
  setCustomDrawers(customs);
  return { slug, label: trimmed, isDefault: false, emoji: e };
}

export function renameDrawer(slug: string, label: string, emoji?: string): Drawer {
  const s = sanitizeSlug(slug);
  if (unnamedDrawers(customDrawers()).some((d) => d.slug === s)) throw new ImageGenError('That drawer came from disk and cannot be renamed.');
  const trimmed = String(label || '').trim();
  if (!trimmed) throw new ImageGenError('A name is required.');
  const e = cleanEmoji(emoji);
  const customs = customDrawers();
  const idx = customs.findIndex((d) => d.slug === s);
  if (idx === -1) throw new ImageGenError('Drawer not found.');
  customs[idx] = { slug: s, label: trimmed, emoji: e };
  setCustomDrawers(customs);
  return { slug: s, label: trimmed, isDefault: false, emoji: e };
}

export async function deleteDrawer(slug: string): Promise<boolean> {
  const s = sanitizeSlug(slug);
  if (unnamedDrawers(customDrawers()).some((d) => d.slug === s)) throw new ImageGenError('That drawer came from disk and cannot be deleted.');
  const customs = customDrawers();
  const next = customs.filter((d) => d.slug !== s);
  if (next.length === customs.length) return false;
  setCustomDrawers(next);
  const dir = join(REFS_DIR, s);
  if (existsSync(dir)) await fs.rm(dir, { recursive: true, force: true });
  return true;
}

// ─── Reference library (CRUD) ────────────────────────────────────────

function subjectDir(subject: Subject): string {
  return join(REFS_DIR, sanitizeSlug(subject));
}

export type ReferenceImageType = 'png' | 'jpeg' | 'webp' | 'gif';

/**
 * Trust the bytes rather than the browser's MIME label. Apart from producing
 * clearer errors, this keeps SVG/HTML payloads out of the directory served by
 * the reference-image route.
 */
export function detectReferenceImageType(buf: Buffer): ReferenceImageType | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length >= 6 && (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a')) return 'gif';
  return null;
}

const REFERENCE_EXT: Record<ReferenceImageType, string> = {
  png: '.png',
  jpeg: '.jpg',
  webp: '.webp',
  gif: '.gif',
};

export function makeUniqueReferenceName(
  originalName: string,
  type: ReferenceImageType,
  unique = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
): string {
  const originalExt = extname(originalName);
  const stem = basename(originalName, originalExt).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60) || 'ref';
  return `${stem}-${unique}${REFERENCE_EXT[type]}`;
}

export async function listReferences(subject: Subject): Promise<string[]> {
  const dir = subjectDir(subject);
  if (!existsSync(dir)) return [];
  const entries = await fs.readdir(dir);
  const files = entries.filter((f) => IMAGE_EXTS.has(extname(f).toLowerCase()));
  const withStat = await Promise.all(
    files.map(async (f) => ({ f, t: (await fs.stat(join(dir, f))).mtimeMs })),
  );
  return withStat.sort((a, b) => b.t - a.t).map((x) => x.f);
}

export async function referencePaths(subject: Subject): Promise<string[]> {
  return (await listReferences(subject)).map((f) => join(subjectDir(subject), f));
}

export async function saveReference(subject: Subject, filename: string, buf: Buffer): Promise<string> {
  const dir = subjectDir(subject);
  await fs.mkdir(dir, { recursive: true });
  const type = detectReferenceImageType(buf);
  if (!type) throw new ImageGenError('Unsupported image. Use PNG, JPEG, WebP, or GIF.');
  // Every upload gets a new name. Same-name phone uploads used to overwrite a
  // reference while the WebView kept showing its cached predecessor.
  for (let attempt = 0; attempt < 5; attempt++) {
    const name = makeUniqueReferenceName(filename, type);
    try {
      await fs.writeFile(join(dir, name), buf, { flag: 'wx' });
      return name;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new ImageGenError('Could not allocate a unique reference filename. Please try again.');
}

export async function deleteReference(subject: Subject, filename: string): Promise<boolean> {
  const target = join(subjectDir(subject), basename(filename));
  try {
    await fs.unlink(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

// ─── Gallery ─────────────────────────────────────────────────────────
