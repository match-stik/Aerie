// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { promises as fs } from 'fs';
import { existsSync, statSync } from 'fs';
import { join, extname, basename } from 'path';
import crypto from 'crypto';
import { getAerieConfig } from '../../config.js';
import { listCompanions } from '../db/companions.js';
import { DATA_DIR, GALLERY_DIR, IMAGE_EXTS, REFS_DIR, VIDEO_EXTS } from './settings.js';
import { sanitizeSlug } from './drawers.js';
import { ImageGenError } from './common.js';

const GALLERY_INDEX = join(GALLERY_DIR, '_index.json');

/**
 * The household cast: this install's companions plus the person they live
 * with. Membership is only ever used to infer who is in a picture from the
 * reference drawers it was generated with — manually assigned Gallery tags may
 * name anyone, household or not.
 */
export type HouseholdCastMember = string;
/**
 * Canonical person tags are stable, lower-case slugs. Household members are
 * special only for reference-drawer inference; manually assigned Gallery tags
 * may name anyone.
 */
export type GalleryPersonTag = string;
/** Backwards-compatible name retained for callers written before custom tags. */
export type CanonicalCastMember = GalleryPersonTag;
export type GalleryCastSource = 'selected-references' | 'manual' | 'none';

export const MAX_GALLERY_PERSON_TAG_LENGTH = 40;
export const MAX_GALLERY_CAST_MEMBERS = 32;

/** Only actual Studio media assets may cross the gallery file boundary. */
// ─── Gallery thumbnails ──────────────────────────────────────────────
// The gallery had none. Studio's Recent strip and the gallery grid both
// loaded the full-size original, so drawing thirty ninety-pixel squares
// pulled about 72 MB down the wire — which is why they painted top-down on
// a phone. Thumbnails are made on first request and kept on disk.
//
// They're asked for with ?w= on the existing gallery URL rather than a new
// route, deliberately: a backend that predates this ignores the parameter
// and serves the original, so the phone can ship before the restart without
// anything breaking in between.
const THUMBS_DIR = join(DATA_DIR, 'gallery-thumbs');
// Chat attachments live in their own cache so the two namespaces can never
// collide on a name, and so clearing one leaves the other alone.
const FILE_THUMBS_DIR = join(DATA_DIR, 'file-thumbs');
// Reference drawers get a third cache. The refs panel draws EVERY drawer's
// pictures at about a hundred pixels, and it was drawing the originals — which
// is why that screen, and only that screen, was heavy enough that Android took
// the whole app when the file picker asked for memory.
const REF_THUMBS_DIR = join(DATA_DIR, 'ref-thumbs');
const THUMB_WIDTHS = new Set([256, 480, 768]);
// .gif is left whole — resizing it would flatten the animation.
const THUMBABLE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/**
 * Make (or reuse) a small copy of one picture.
 *
 * `cacheKey` must name something whose contents never change — a gallery
 * filename carries its own timestamp and hash, an uploaded file is named by
 * UUID. Both are write-once, so a cached thumbnail can never go stale.
 *
 * Returns null for anything it will not shrink; every caller treats that as
 * "send the original", which is how this behaved before thumbnails existed.
 */
async function cachedThumbnail(
  source: string,
  cacheDir: string,
  cacheKey: string,
  requestedWidth: unknown,
  // Callers who are only ever drawing a POSTAGE STAMP may take the first frame
  // of an animation instead of the whole thing. Off by default, because the
  // rule above is right everywhere the picture is meant to move: a gallery
  // tile, a chat bubble, a lightbox. A reference drawer square is a hundred
  // pixels wide and nobody has ever watched one.
  opts: { stillFromAnimated?: boolean } = {},
): Promise<string | null> {
  const width = Number(requestedWidth);
  if (!THUMB_WIDTHS.has(width)) return null;
  const ext = extname(cacheKey).toLowerCase();
  const animatedStill = opts.stillFromAnimated === true && ext === '.gif';
  if (!THUMBABLE_EXTS.has(ext) && !animatedStill) return null;
  if (!existsSync(source)) return null;

  const dir = join(cacheDir, String(width));
  const out = join(dir, `${cacheKey}.webp`);
  if (existsSync(out)) return out;

  try {
    await fs.mkdir(dir, { recursive: true });
    const sharp = (await import('sharp')).default;
    // Written under a unique name and moved into place, so two requests
    // racing for the same thumbnail can never hand anyone half a file.
    const staging = `${out}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    // sharp reads only the first frame unless told otherwise, which is exactly
    // what the still-from-animated case wants and costs nothing for the rest.
    await sharp(source)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(staging);
    await fs.rename(staging, out);
    return out;
  } catch (error) {
    // Falling back to the original is the old behaviour — slow, but whole.
    console.error('[thumbnail] failed for', cacheKey, error);
    return null;
  }
}

export async function galleryThumbnail(
  filename: string,
  requestedWidth: unknown,
): Promise<string | null> {
  // The route already normalizes the name; basename here keeps the thumbnail
  // inside the gallery even for a caller that forgets to.
  const name = basename(filename);
  return cachedThumbnail(join(GALLERY_DIR, name), THUMBS_DIR, name, requestedWidth);
}

/**
 * The same small copy, for an uploaded file served from /api/files/:id.
 *
 * Every picture we send the user arrives as an attachment, and chat was drawing
 * those full-size originals into bubbles a few hundred pixels wide — the one
 * surface in the house that never got thumbnails when Studio did.
 */
export async function fileThumbnail(
  file: { path: string; filename: string },
  requestedWidth: unknown,
): Promise<string | null> {
  // KEYED ON THE STORED NAME, NEVER THE ORIGINAL ONE.
  //
  // This used to key the cache on file.filename — the name the uploader gave
  // it — and every photograph from an Android phone is called image.jpg. So
  // every single one of them collided on one cache entry, and the FIRST one
  // ever thumbnailed was served in place of all the rest: a user sent a
  // screenshot and the bubble showed them a picture from the day before, on
  // their own device, surviving a hard refresh, because the cache was doing
  // exactly what it had been told.
  //
  // file.path ends in the uuid this file was stored under, which is unique by
  // construction and carries the same extension, so the thumbable check is
  // unaffected.
  return cachedThumbnail(file.path, FILE_THUMBS_DIR, basename(file.path), requestedWidth);
}

/**
 * The same small copy, for a reference image in a subject's drawer.
 *
 * Unlike a gallery file or an uploaded attachment, a reference filename is NOT
 * write-once — their person can upload a new picture over an old name. So the cache key
 * carries the file's modified time, which restores the guarantee the other two
 * get for free.
 *
 * Animated gifs DO get a thumbnail here, unlike everywhere else — a still of
 * the first frame. Two of these drawers hold animated masters (one is 17 MB on
 * its own) and the panel draws every drawer at once, which is what got the app
 * killed behind the file picker. Nobody watches a hundred-pixel square. Asking
 * for the file without ?w= still returns the whole animation, so the reference
 * itself is untouched and generation still sees the real thing.
 */
export async function referenceThumbnail(
  subject: string,
  filename: string,
  requestedWidth: unknown,
): Promise<string | null> {
  const source = join(REFS_DIR, subject, basename(filename));
  let stamp: number;
  try {
    stamp = statSync(source).mtimeMs;
  } catch {
    return null;
  }
  const key = `${subject}__${Math.round(stamp)}__${basename(filename)}`;
  return cachedThumbnail(source, REF_THUMBS_DIR, key, requestedWidth, { stillFromAnimated: true });
}

export function normalizeGalleryFilename(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const name = basename(value);
  if (name !== value || name === '.' || name === '..') return null;
  const extension = extname(name).toLowerCase();
  return IMAGE_EXTS.has(extension) || VIDEO_EXTS.has(extension) ? name : null;
}

export interface GalleryMeta {
  messageId?: string;
  threadId?: string;
  createdAt?: string;
  /** Effective prompt sent to the renderer (legacy-compatible field). */
  prompt?: string;
  /** User-authored prompt before a Studio style was appended. */
  sourcePrompt?: string;
  styleId?: string;
  model?: string;
  backend?: string;
  width?: number;
  height?: number;
  folderId?: string;
  aspectRatio?: string;
  /** Legacy name for the reference drawers used by this generation. */
  references?: string[];
  /** Reference inputs are intentionally distinct from who appears in-frame. */
  referenceDrawers?: string[];
  /** Absent means unclassified; an empty array explicitly means no people. */
  cast?: GalleryPersonTag[];
  castSource?: GalleryCastSource;
}

/**
 * Household membership changes when a companion is added, so it is read from
 * the install rather than hardcoded — but it is consulted once per tag on
 * gallery reads, so the answer is cached briefly rather than re-queried.
 */
const CAST_TTL_MS = 5_000;
let castCache: { slugs: Set<string>; readAt: number } | null = null;

/** Stable, lower-case slug form of a human-entered name. */
function slugifyPersonName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    // Spaces and ordinary name punctuation become readable separators.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function householdCastSlugs(): Set<string> {
  const now = Date.now();
  if (castCache && now - castCache.readAt < CAST_TTL_MS) return castCache.slugs;
  const slugs = new Set<string>();
  try {
    for (const companion of listCompanions()) {
      if (companion.slug) slugs.add(companion.slug);
    }
  } catch {
    // A gallery read must not fail because the companion table is unavailable.
  }
  try {
    const owner = slugifyPersonName(getAerieConfig().identity.user_name);
    if (owner) slugs.add(owner);
  } catch {
    // Likewise if config has not been loaded yet — an unresolved alias only
    // costs grouping, whereas throwing would take the whole gallery down.
  }
  castCache = { slugs, readAt: now };
  return slugs;
}

/**
 * Resolve a drawer slug onto the household member it depicts, or null when it
 * names no one — a style drawer, or a person this install has never heard of.
 * A `<member>-temp` drawer is a second reference set for someone already in the
 * cast and resolves onto them, so their pictures stay grouped as one person.
 */
function householdCastMember(slug: string): HouseholdCastMember | null {
  const cast = householdCastSlugs();
  if (cast.has(slug)) return slug;
  const base = slug.endsWith('-temp') ? slug.slice(0, -'-temp'.length) : '';
  return base && cast.has(base) ? base : null;
}

function cleanSlugList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value
    .map((item) => sanitizeSlug(String(item)))
    .filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/**
 * Turn a human-entered name into the stable tag stored in Gallery metadata.
 * This deliberately does not require a pre-existing person registry: adding a
 * tag is what teaches the Gallery that the person exists.
 */
export function normalizeGalleryPersonTag(value: unknown): GalleryPersonTag | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Commas delimit tags in GET filters, so they cannot also be part of one.
  // Bound input work before Unicode normalization expands it.
  if (!trimmed || trimmed.includes(',') || Array.from(trimmed).length > MAX_GALLERY_PERSON_TAG_LENGTH * 2) return null;
  const slug = slugifyPersonName(trimmed);
  if (!slug || slug.length > MAX_GALLERY_PERSON_TAG_LENGTH) return null;
  return householdCastMember(slug) ?? slug;
}

/** Canonical, stable exact-cast representation. Empty is meaningful. */
export function canonicalizeGalleryCast(value: unknown): GalleryPersonTag[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cast = value
    .map(normalizeGalleryPersonTag)
    .filter((item): item is GalleryPersonTag => item !== null);
  return [...new Set(cast)]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_GALLERY_CAST_MEMBERS);
}

/** Strict request-boundary parser; unlike disk recovery it rejects bad tags. */
export function parseGalleryCastInput(value: unknown): GalleryPersonTag[] | null {
  if (!Array.isArray(value) || value.length > MAX_GALLERY_CAST_MEMBERS) return null;
  if (!value.every((item) => normalizeGalleryPersonTag(item) !== null)) return null;
  return canonicalizeGalleryCast(value) ?? [];
}

/**
 * Legacy `references` are sufficient for classification only when every drawer
 * names a household member. Mixed/custom drawers remain unknown rather than
 * being guessed from prompts.
 */
export function deriveGalleryCast(meta: GalleryMeta): {
  cast: GalleryPersonTag[] | undefined;
  castSource: GalleryCastSource | undefined;
} {
  if (Object.prototype.hasOwnProperty.call(meta, 'cast') && Array.isArray(meta.cast)) {
    const cast = canonicalizeGalleryCast(meta.cast) ?? [];
    return {
      cast,
      castSource: meta.castSource ?? (cast.length ? 'manual' : 'none'),
    };
  }
  const refs = cleanSlugList(meta.referenceDrawers ?? meta.references);
  if (!refs?.length || refs.some((slug) => !householdCastMember(slug))) {
    return { cast: undefined, castSource: undefined };
  }
  return {
    cast: canonicalizeGalleryCast(refs),
    castSource: 'selected-references',
  };
}

async function readGalleryIndex(): Promise<Record<string, GalleryMeta>> {
  if (!existsSync(GALLERY_INDEX)) return {};
  try {
    const parsed = JSON.parse(await fs.readFile(GALLERY_INDEX, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Gallery index root must be an object.');
    }
    return parsed as Record<string, GalleryMeta>;
  } catch (error) {
    // A bad read must never silently become an empty index that the next
    // mutation persists — that would wipe every image's active metadata.
    // Preserve the bytes for recovery, then fail closed until repaired.
    const backup = `${GALLERY_INDEX}.corrupt-${Date.now()}`;
    try { await fs.copyFile(GALLERY_INDEX, backup); } catch {}
    console.error(`[image-gen] gallery index unreadable — preserved at ${backup}:`, error);
    throw new ImageGenError(`Gallery index is unreadable; preserved a recovery copy at ${basename(backup)}.`);
  }
}

// Concurrent read-modify-write cycles (multi-image jobs record meta per file)
// interleave and drop each other's entries; a write interrupted mid-file is
// how the index turns unparseable in the first place. Serialize all mutations
// and land each one atomically via tmp + rename.
let galleryIndexLock: Promise<unknown> = Promise.resolve();

function withGalleryIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = galleryIndexLock.then(fn, fn);
  galleryIndexLock = run.catch(() => {});
  return run;
}

async function writeGalleryIndex(idx: Record<string, GalleryMeta>): Promise<void> {
  await fs.mkdir(GALLERY_DIR, { recursive: true });
  const tmp = `${GALLERY_INDEX}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(idx, null, 2));
  await fs.rename(tmp, GALLERY_INDEX);
}

export async function getGalleryMeta(filename: string): Promise<GalleryMeta | null> {
  const name = normalizeGalleryFilename(filename);
  if (!name) return null;
  const idx = await readGalleryIndex();
  return idx[name] ?? null;
}

export async function recordGalleryMeta(filename: string, meta: GalleryMeta): Promise<void> {
  const name = normalizeGalleryFilename(filename);
  if (!name) throw new ImageGenError('Invalid gallery filename.');
  console.log(`[recordGalleryMeta] ${filename}: prompt=${meta.prompt?.slice(0, 50) || 'NONE'}`);
  await withGalleryIndexLock(async () => {
    const idx = await readGalleryIndex();
    idx[name] = { ...meta };
    await writeGalleryIndex(idx);
  });
}

export interface GalleryItem {
  filename: string;
  createdAt: string;
  size: number;
  mediaType: 'image' | 'video';
  messageId?: string;
  threadId?: string;
  prompt?: string;
  sourcePrompt?: string;
  styleId?: string;
  model?: string;
  backend?: string;
  width?: number;
  height?: number;
  folderId?: string;
  aspectRatio?: string;
  references?: string[];
  referenceDrawers?: string[];
  cast?: GalleryPersonTag[];
  castSource?: GalleryCastSource;
}

export async function listGallery(limit = Number.POSITIVE_INFINITY): Promise<GalleryItem[]> {
  if (!existsSync(GALLERY_DIR)) return [];
  const idx = await readGalleryIndex();
  const entries = await fs.readdir(GALLERY_DIR);
  const imgs = entries.filter((f) => {
    const ext = extname(f).toLowerCase();
    return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext);
  });
  const items = await Promise.all(
    imgs.map(async (f) => {
      const st = await fs.stat(join(GALLERY_DIR, f));
      const meta = idx[f] || {};
      const referenceDrawers = cleanSlugList(meta.referenceDrawers ?? meta.references);
      const { cast, castSource } = deriveGalleryCast(meta);
      return {
        filename: f,
        mediaType: (VIDEO_EXTS.has(extname(f).toLowerCase()) ? 'video' : 'image') as 'image' | 'video',
        createdAt: meta.createdAt || new Date(st.mtimeMs).toISOString(),
        size: st.size,
        messageId: meta.messageId,
        threadId: meta.threadId,
        prompt: meta.prompt,
        sourcePrompt: meta.sourcePrompt,
        styleId: meta.styleId,
        model: meta.model,
        backend: meta.backend,
        width: meta.width,
        height: meta.height,
        folderId: meta.folderId,
        aspectRatio: meta.aspectRatio,
        references: meta.references ?? referenceDrawers,
        referenceDrawers,
        cast,
        castSource,
      };
    }),
  );
  return items
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.filename.localeCompare(b.filename))
    .slice(0, limit);
}

export type GalleryCastMode = 'exact' | 'includes';
export type GalleryCastState = 'known' | 'unknown' | 'none';

export interface GalleryListFilter {
  cast?: GalleryPersonTag[];
  castMode?: GalleryCastMode;
  castState?: GalleryCastState;
  folderId?: string | null;
}

export function galleryItemMatchesFilter(item: GalleryItem, filter: GalleryListFilter): boolean {
  if (filter.folderId !== undefined) {
    if (filter.folderId === null) {
      if (item.folderId) return false;
    } else if (item.folderId !== filter.folderId) {
      return false;
    }
  }

  if (filter.castState === 'unknown' && item.cast !== undefined) return false;
  if (filter.castState === 'none' && (item.cast === undefined || item.cast.length !== 0)) return false;
  if (filter.castState === 'known' && (item.cast === undefined || item.cast.length === 0)) return false;

  if (filter.cast) {
    if (item.cast === undefined) return false;
    const wanted = canonicalizeGalleryCast(filter.cast) ?? [];
    if (filter.castMode === 'includes') {
      if (!wanted.every((member) => item.cast?.includes(member))) return false;
    } else if (item.cast.length !== wanted.length || !wanted.every((member, idx) => item.cast?.[idx] === member)) {
      return false;
    }
  }
  return true;
}

interface GalleryCursorPayload { createdAt: string; filename: string; }

export function encodeGalleryCursor(item: Pick<GalleryItem, 'createdAt' | 'filename'>): string {
  return Buffer.from(JSON.stringify({ createdAt: item.createdAt, filename: item.filename }), 'utf8').toString('base64url');
}

export function decodeGalleryCursor(cursor: string): GalleryCursorPayload {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<GalleryCursorPayload>;
    if (typeof value.createdAt !== 'string' || typeof value.filename !== 'string' || !value.createdAt || !value.filename) throw new Error('invalid');
    const filename = normalizeGalleryFilename(value.filename);
    if (!filename) throw new Error('invalid');
    return { createdAt: value.createdAt, filename };
  } catch {
    throw new ImageGenError('Invalid gallery cursor.');
  }
}

export interface GalleryPage {
  items: GalleryItem[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

export interface GalleryPageOptions {
  limit?: number;
  cursor?: string;
  filter?: GalleryListFilter;
}

export function paginateGalleryItems(allItems: GalleryItem[], options: GalleryPageOptions = {}): GalleryPage {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 30)));
  let items = allItems.filter((item) => galleryItemMatchesFilter(item, options.filter ?? {}));
  const total = items.length;

  if (options.cursor) {
    const cursor = decodeGalleryCursor(options.cursor);
    const exact = items.findIndex((item) => item.createdAt === cursor.createdAt && item.filename === cursor.filename);
    if (exact >= 0) {
      items = items.slice(exact + 1);
    } else {
      // Keep a cursor useful if the boundary asset was deleted between pages.
      items = items.filter((item) =>
        item.createdAt < cursor.createdAt
        || (item.createdAt === cursor.createdAt && item.filename > cursor.filename));
    }
  }

  const pageItems = items.slice(0, limit);
  const hasMore = items.length > limit;
  return {
    items: pageItems,
    nextCursor: hasMore && pageItems.length ? encodeGalleryCursor(pageItems[pageItems.length - 1]) : null,
    hasMore,
    total,
  };
}

export async function listGalleryPage(options: GalleryPageOptions = {}): Promise<GalleryPage> {
  return paginateGalleryItems(await listGallery(), options);
}

export interface GalleryCastGroupSummary {
  groups: Array<{ key: string; cast: GalleryPersonTag[]; count: number }>;
  unknownCount: number;
  noPeopleCount: number;
  total: number;
}

export function summarizeGalleryCastGroups(items: GalleryItem[]): GalleryCastGroupSummary {
  const counts = new Map<string, { cast: GalleryPersonTag[]; count: number }>();
  let unknownCount = 0;
  let noPeopleCount = 0;
  for (const item of items) {
    if (item.cast === undefined) { unknownCount++; continue; }
    const cast = canonicalizeGalleryCast(item.cast) ?? [];
    if (cast.length === 0) { noPeopleCount++; continue; }
    const key = cast.join(',');
    const group = counts.get(key) ?? { cast, count: 0 };
    group.count++;
    counts.set(key, group);
  }
  return {
    groups: [...counts.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    unknownCount,
    noPeopleCount,
    total: items.length,
  };
}

export async function galleryCastGroups(): Promise<GalleryCastGroupSummary> {
  return summarizeGalleryCastGroups(await listGallery());
}

export interface GalleryMetaPatch {
  folderId?: string | null;
  cast?: GalleryPersonTag[] | null;
  castSource?: GalleryCastSource | null;
}

export interface GalleryMutationStatus {
  filename: string;
  status: 'updated' | 'not_found';
}

export async function patchGalleryItems(filenames: string[], patch: GalleryMetaPatch): Promise<GalleryMutationStatus[]> {
  const names = [...new Set(filenames.map(String).filter(Boolean))];
  return withGalleryIndexLock(async () => {
    const idx = await readGalleryIndex();
    const statuses: GalleryMutationStatus[] = [];
    let changed = false;
    for (const requestedName of names) {
      const name = normalizeGalleryFilename(requestedName);
      if (!name || !existsSync(join(GALLERY_DIR, name))) {
        statuses.push({ filename: name ?? requestedName, status: 'not_found' });
        continue;
      }
      const next: GalleryMeta = { ...(idx[name] ?? {}) };
      if (Object.prototype.hasOwnProperty.call(patch, 'folderId')) {
        if (patch.folderId) next.folderId = patch.folderId;
        else delete next.folderId;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'cast')) {
        if (patch.cast === null) {
          delete next.cast;
          delete next.castSource;
        } else {
          next.cast = canonicalizeGalleryCast(patch.cast) ?? [];
          next.castSource = patch.castSource ?? (next.cast.length ? 'manual' : 'none');
        }
      }
      idx[name] = next;
      statuses.push({ filename: name, status: 'updated' });
      changed = true;
    }
    if (changed) await writeGalleryIndex(idx);
    return statuses;
  });
}

export async function unassignGalleryFolder(folderId: string): Promise<number> {
  return withGalleryIndexLock(async () => {
    const idx = await readGalleryIndex();
    let changed = 0;
    for (const meta of Object.values(idx)) {
      if (meta.folderId !== folderId) continue;
      delete meta.folderId;
      changed++;
    }
    if (changed) await writeGalleryIndex(idx);
    return changed;
  });
}

export interface GalleryDeleteResult {
  filename: string;
  status: 'deleted' | 'not_found';
  fileRemoved: boolean;
  metadataRemoved: boolean;
}

export async function deleteGalleryItemDetailed(filename: string): Promise<GalleryDeleteResult> {
  const name = normalizeGalleryFilename(filename);
  if (!name) {
    return {
      filename: typeof filename === 'string' ? basename(filename) : '',
      status: 'not_found',
      fileRemoved: false,
      metadataRemoved: false,
    };
  }
  let fileRemoved = false;
  let metadataRemoved = false;
  const target = join(GALLERY_DIR, name);
  if (existsSync(target)) { await fs.unlink(target); fileRemoved = true; }
  await withGalleryIndexLock(async () => {
    const idx = await readGalleryIndex();
    if (idx[name]) {
      delete idx[name];
      await writeGalleryIndex(idx);
      metadataRemoved = true;
    }
  });
  return {
    filename: name,
    status: fileRemoved || metadataRemoved ? 'deleted' : 'not_found',
    fileRemoved,
    metadataRemoved,
  };
}

export async function deleteGalleryItem(filename: string): Promise<boolean> {
  return (await deleteGalleryItemDetailed(filename)).status === 'deleted';
}

// ─── Generation ──────────────────────────────────────────────────────
