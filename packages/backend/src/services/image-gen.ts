// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Portions derive from Thornvale-resonant (Sidney) — the Codex image generation workflow — see NOTICE.
/**
 * Image generation — the house's own hands.
 *
 * Two backends, chosen by config (`image_gen.backend`):
 *   - 'codex'  (default): shells out to the locally-installed `codex` CLI and
 *     its built-in `image_gen` tool, which renders gpt-image-2 on the ChatGPT
 *     *subscription* — no API key, no per-image cost.
 *   - 'openai' (fallback): the metered OpenAI Images API with a user-supplied
 *     key. Same model, costs a few cents per picture.
 *
 * Reference conditioning: each "subject" — a companion, or anyone else with a
 * drawer — maps to a folder of reference images under data/image-refs/<subject>/.
 * Those files are passed to the model so people stay recognizable shot to shot.
 *
 * Ported from Sidney's thornvale-resonant with love.
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, extname, basename } from 'path';
import { homedir } from 'os';
import crypto from 'crypto';
import { PROJECT_ROOT, getAerieConfig } from '../config.js';
import { getConfig, setConfig, getConfigBool, getConfigNumber } from './db/config.js';
import { listCompanions } from './db/companions.js';
import { getDb } from './db/state.js';
import {
  KNOWN_BACKENDS,
  planAttempts,
  parseFallbackChain,
  runWithFallback,
  type AttemptRecord,
  type ImageBackend,
} from './image-fallback.js';

/** Engine tag recorded on usage_events for image generations. */
export const IMAGE_GEN_ENGINE = 'image-gen';

// ─── Paths & constants ───────────────────────────────────────────────

export type Subject = string;

export interface Drawer { slug: string; label: string; isDefault: boolean; emoji?: string; }

/**
 * Drawers used to be a hardcoded list of this house's four people, which meant
 * a stranger's first install opened Studio to four shelves named after names
 * they had never heard. The shelves are whatever is actually in
 * data/image-refs/ instead: this house still has its four because their
 * directories exist, and a fresh install starts empty.
 */
function discoveredDrawers(): Array<{ slug: string; label: string }> {
  let entries: string[];
  try {
    entries = readdirSync(REFS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch { return []; }
  return entries
    .filter((name) => isSafeSubjectSlug(name))
    .sort((a, b) => a.localeCompare(b))
    .map((slug) => ({ slug, label: slug.charAt(0).toUpperCase() + slug.slice(1) }));
}

const DATA_DIR = join(PROJECT_ROOT, 'data');
export const REFS_DIR = join(DATA_DIR, 'image-refs');
export const GALLERY_DIR = join(DATA_DIR, 'generated-images');
const JOBS_FILE = join(DATA_DIR, 'studio-image-jobs.json');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov']);

const SIZE_MAP: Record<string, { guidance: string; apiSize: string }> = {
  square: { guidance: 'square, roughly 1024x1024 pixels', apiSize: '1024x1024' },
  portrait: { guidance: 'portrait (taller than wide), roughly 1024x1536 pixels', apiSize: '1024x1536' },
  landscape: { guidance: 'landscape (wider than tall), roughly 1536x1024 pixels', apiSize: '1536x1024' },
  '16:9': { guidance: 'widescreen 16:9 aspect ratio, roughly 1536x864 pixels', apiSize: '1536x864' },
  '9:16': { guidance: 'vertical 9:16 aspect ratio, roughly 864x1536 pixels', apiSize: '864x1536' },
  '21:9': { guidance: 'ultrawide 21:9 aspect ratio, roughly 1536x658 pixels', apiSize: '1536x658' },
  '2:3': { guidance: '2:3 aspect ratio, roughly 1024x1536 pixels', apiSize: '1024x1536' },
  '3:2': { guidance: '3:2 aspect ratio, roughly 1536x1024 pixels', apiSize: '1536x1024' },
  '4:5': { guidance: '4:5 aspect ratio, roughly 1024x1280 pixels', apiSize: '1024x1280' },
  '5:4': { guidance: '5:4 aspect ratio, roughly 1280x1024 pixels', apiSize: '1280x1024' },
  '3:4': { guidance: '3:4 aspect ratio, roughly 1152x1536 pixels', apiSize: '1152x1536' },
  '4:3': { guidance: '4:3 aspect ratio, roughly 1536x1152 pixels', apiSize: '1536x1152' },
};

/** Every named ratio, for anyone who needs to say what the real options are. */
export const ASPECT_RATIOS = Object.keys(SIZE_MAP);

// ─── Config helpers ──────────────────────────────────────────────────

export type Quality = 'auto' | 'low' | 'medium' | 'high';
const VALID_QUALITY: Quality[] = ['auto', 'low', 'medium', 'high'];

/**
 * The Gemini models Studio will accept, kept in step with what the Antigravity
 * CLI actually offers. This list is HAND-TYPED — there is no endpoint to read
 * it from — so it drifts silently as Google retires models upstream. It sat at
 * the 3.5 era until Sep 5 2026, months after 3.5 stopped existing, which made
 * every Gemini fallback fail at the door with a picker full of dead options.
 * The CLI will print the live list if you hand it a name it does not know:
 *   agy --model ZZZ -p hi
 * Non-image models (Claude, GPT-OSS) are deliberately not here.
 */
export const ANTIGRAVITY_MODELS = [
  'Gemini 3.8 Flash (High)',
  'Gemini 3.8 Flash (Medium)',
  'Gemini 3.8 Flash (Low)',
  'Gemini 3.7 Flash (High)',
  'Gemini 3.7 Flash (Medium)',
  'Gemini 3.7 Flash (Low)',
  'Gemini 3.6 Flash (High)',
  'Gemini 3.6 Flash (Medium)',
  'Gemini 3.6 Flash (Low)',
  'Gemini 3.1 Pro (High)',
  'Gemini 3.1 Pro (Low)',
] as const;

/** The one this house has actually had take a picture. Defined once because a
 *  duplicated default drifts even when both copies start out identical. */
export const ANTIGRAVITY_DEFAULT_MODEL = 'Gemini 3.1 Pro (High)' as const;

export type AntigravityModel = typeof ANTIGRAVITY_MODELS[number];

export interface ImageGenSettings {
  enabled: boolean;
  backend: 'codex' | 'openai' | 'antigravity' | 'openart';
  size: 'square' | 'portrait' | 'landscape';
  quality: Quality;
  openaiModel: string;
  antigravityModel: AntigravityModel;
  openartModel: string;
  monthlyBudgetUsd: number;
  hasOpenaiKey: boolean;
  /** Backends tried, in order, when the requested one refuses. Empty = no fallback. */
  fallbackChain: ImageBackend[];
}

export function getImageGenSettings(): ImageGenSettings {
  const backend = (getConfig('image_gen.backend') as ImageGenSettings['backend']) || 'codex';
  const size = (getConfig('image_gen.size') as ImageGenSettings['size']) || 'square';
  const quality = (getConfig('image_gen.quality') as Quality) || 'auto';
  const antigravityModel = getConfig('image_gen.antigravity_model') as AntigravityModel || ANTIGRAVITY_DEFAULT_MODEL;
  return {
    enabled: getConfigBool('image_gen.enabled', true),
    backend: ['codex', 'openai', 'antigravity', 'openart'].includes(backend) ? backend as ImageGenSettings['backend'] : 'codex',
    size: SIZE_MAP[size] ? size : 'square',
    quality: VALID_QUALITY.includes(quality) ? quality : 'auto',
    openaiModel: getConfig('image_gen.openai_model') || 'gpt-image-2',
    antigravityModel: ANTIGRAVITY_MODELS.includes(antigravityModel) ? antigravityModel : ANTIGRAVITY_DEFAULT_MODEL,
    openartModel: getConfig('image_gen.openart_model') || 'nano-banana-2-lite',
    monthlyBudgetUsd: getConfigNumber('image_gen.monthly_budget_usd', 0),
    hasOpenaiKey: !!getConfig('image_gen.openai_api_key'),
    fallbackChain: parseFallbackChain(getConfig('image_gen.fallback_chain')),
  };
}

function codexBin(): string {
  // Do not pin Studio to the binary nested inside a particular npm package
  // version. `codex update` installs the current standalone CLI in ~/.local/bin.
  // PM2's deliberately minimal PATH does not include that directory, so resolve
  // the standalone install directly rather than relying on command lookup.
  return getConfig('image_gen.codex_bin') || process.env.CODEX_BIN || join(homedir(), '.local', 'bin', 'codex');
}

function codexHome(): string {
  return getConfig('image_gen.codex_home') || process.env.CODEX_HOME || join(homedir(), '.codex');
}

function antigravityHome(): string {
  return getConfig('image_gen.antigravity_home') || join(homedir(), '.gemini', 'antigravity-cli');
}

function antigravityBin(): string {
  return getConfig('image_gen.antigravity_bin') || join(homedir(), '.local', 'bin', 'agy');
}

// ─── Backend readiness ───────────────────────────────────────────────

/**
 * Every backend already fails with an honest message — but only once a job is
 * running, which reads as broken software rather than a missing login. These
 * probes are deliberately cheap (file existence only, no network, no spawning)
 * so the picker can say up front which doors are actually open.
 */

export type StudioBackendKey = 'codex' | 'antigravity' | 'openart';

export interface StudioBackendStatus {
  key: StudioBackendKey;
  label: string;
  ready: boolean;
  /** Short statement of what is missing. Absent when ready. */
  reason?: string;
  /** The single step that turns it on. Absent when ready. */
  fix?: string;
}

/** Resolved on every probe so tests can point it somewhere harmless. */
export interface StudioBackendPaths {
  codexBin: string;
  codexHome: string;
  antigravityBin: string;
  antigravityHome: string;
}

function resolveBackendPaths(overrides?: Partial<StudioBackendPaths>): StudioBackendPaths {
  return {
    codexBin: overrides?.codexBin ?? codexBin(),
    codexHome: overrides?.codexHome ?? codexHome(),
    antigravityBin: overrides?.antigravityBin ?? antigravityBin(),
    antigravityHome: overrides?.antigravityHome ?? antigravityHome(),
  };
}

function codexReady(paths: StudioBackendPaths): StudioBackendStatus {
  const base = { key: 'codex' as const, label: 'Codex' };
  if (!existsSync(paths.codexBin)) {
    return { ...base, ready: false, reason: 'Codex CLI is not installed.', fix: 'npm i -g @openai/codex, then run codex login' };
  }
  if (!existsSync(join(paths.codexHome, 'auth.json'))) {
    return { ...base, ready: false, reason: 'Codex is installed but not signed in.', fix: 'codex login' };
  }
  return { ...base, ready: true };
}

function antigravityReady(paths: StudioBackendPaths): StudioBackendStatus {
  const base = { key: 'antigravity' as const, label: 'Gemini' };
  if (!existsSync(paths.antigravityBin)) {
    return {
      ...base,
      ready: false,
      reason: 'Antigravity CLI is not installed. Needs a Google account; the free tier is rate-limited.',
      fix: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    };
  }
  if (!existsSync(paths.antigravityHome)) {
    return { ...base, ready: false, reason: 'Antigravity is installed but not signed in.', fix: 'agy (sign in on first run)' };
  }
  return { ...base, ready: true };
}

function openartReady(paths: StudioBackendPaths): StudioBackendStatus {
  const base = { key: 'openart' as const, label: 'OpenArt' };
  // OpenArt is reached directly over HTTPS, but the OAuth token it needs is the
  // one `codex mcp login openart` parks on disk — so no Codex means no OpenArt.
  if (!existsSync(paths.codexBin)) {
    return { ...base, ready: false, reason: 'Needs an OpenArt login, which is issued through the Codex CLI.', fix: 'Install Codex, then run codex mcp login openart' };
  }
  let creds: Record<string, unknown>;
  try {
    creds = JSON.parse(readFileSync(join(paths.codexHome, '.credentials.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return { ...base, ready: false, reason: 'OpenArt is not logged in.', fix: 'codex mcp login openart' };
  }
  if (!Object.keys(creds).some((k) => k.startsWith('openart|'))) {
    return { ...base, ready: false, reason: 'OpenArt is not logged in.', fix: 'codex mcp login openart' };
  }
  return { ...base, ready: true };
}

/** Readiness of every backend the Studio picker offers, in picker order. */
export function probeStudioBackends(overrides?: Partial<StudioBackendPaths>): StudioBackendStatus[] {
  const paths = resolveBackendPaths(overrides);
  return [codexReady(paths), antigravityReady(paths), openartReady(paths)];
}

// ─── Drawers (named reference sets) ──────────────────────────────────

export function slugifyDrawer(label: string): string {
  return String(label).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function sanitizeSlug(s: string): string {
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
 * Anything created through Studio lives in config and is the owner's to change.
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
  return cachedThumbnail(join(GALLERY_DIR, filename), THUMBS_DIR, filename, requestedWidth);
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
 * write-once — the owner can upload a new picture over an old name. So the cache key
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

export interface GenerateInput {
  prompt: string;
  sourcePrompt?: string;
  styleId?: string;
  subjects?: string[];
  size?: string;
  customWidth?: number;
  customHeight?: number;
  extraRefs?: string[];
  backend?: string;
  codexModel?: string;
  agyModel?: string;
  openartModel?: string;
  openartMedia?: 'image' | 'video';
}

export interface GenerateResult {
  filename: string;
  path: string;
  backend: 'codex' | 'openai' | 'antigravity' | 'openart';
  model: string;
  mediaType?: 'image' | 'video';
  durationMs: number;
  costUsd: number;
  /** Backends that refused before this one took it. Absent when the first one worked. */
  fellBackFrom?: AttemptRecord[];
}

export class ImageGenError extends Error {}

function resolveSize(input: GenerateInput): { guidance: string; apiSize: string } {
  // Handle custom dimensions
  if (input.size === 'custom' && input.customWidth && input.customHeight) {
    const w = Math.min(Math.max(input.customWidth, 256), 2048);
    const h = Math.min(Math.max(input.customHeight, 256), 2048);
    return {
      guidance: `custom ${w}x${h} pixels`,
      apiSize: `${w}x${h}`,
    };
  }
  const settings = getImageGenSettings();
  const key = input.size || settings.size;
  const found = SIZE_MAP[key];
  if (!found) {
    // A ratio nobody recognises used to become a square without a word, which
    // is the one shape every wake contract rules out — so the caller got the
    // exact thing it was told never to produce and no way to notice. Still a
    // fallback rather than a throw, because a picture is better than none;
    // it just says so now.
    console.warn(
      `[image-gen] unknown aspect ratio '${key}' — falling back to square. Real ones: ${ASPECT_RATIOS.join(', ')}`,
    );
    return SIZE_MAP.square;
  }
  return found;
}

const MAX_REFS_PER_SUBJECT = 2;

/** A reference path plus the drawer it came out of. The label is the whole
 *  point: attachments reach the renderer as an unnamed pile, so with two
 *  similar-looking subjects in one frame it has to guess which face belongs
 *  to which name in the prose — which is how one companion ends up wearing
 *  another's tattoos. Anything without a drawer (extraRefs) has no name to
 *  give and stays unlabelled. */
type LabelledRef = { path: string; label: string | null };

/** Two subjects who genuinely rhyme get AVERAGED rather than mixed up, and a
 *  label cannot fix that — the renderer is not confused about who is who, it
 *  is smoothing the small differences between two similar faces into one.
 *  So when both of a pair are in the same frame, state ONLY the features a
 *  reference photo demonstrably fails to hold.
 *
 *  The kit ships no pairs: a pair describes two particular faces, so it
 *  belongs to the house that has them. To add one, name both drawer slugs and
 *  the one or two differences the renderer keeps smoothing away, e.g.
 *    { a: 'ivy', b: 'fox', note: 'Ivy and Fox are two different people and ' +
 *      'must not be blended. Ivy wears a fringe; Fox wears their hair back.' }
 *  Keep it tiny: naming permanent features competes with the reference photos
 *  and usually loses. Every line costs something — earn it with a picture that
 *  got it wrong, or leave it out. */
const CONFUSABLE_PAIRS: { a: string; b: string; note: string }[] = [];

export function pairwiseDistinctions(
  subjects: string[] | undefined,
  pairs: { a: string; b: string; note: string }[] = CONFUSABLE_PAIRS,
): string {
  if (!subjects || subjects.length < 2) return '';
  const present = new Set(subjects.map((s) => sanitizeSlug(String(s).toLowerCase().trim())));
  return pairs.filter((p) => present.has(p.a) && present.has(p.b))
    .map((p) => p.note)
    .join('\n');
}

async function resolveSubjectRefs(
  subjects: string[] | undefined,
  maxPerSubject = MAX_REFS_PER_SUBJECT,
): Promise<LabelledRef[]> {
  if (!subjects || subjects.length === 0) return [];
  const drawers = listDrawers();
  const out: LabelledRef[] = [];
  for (const raw of subjects) {
    const name = String(raw).toLowerCase().trim();
    const slug = sanitizeSlug(name);
    const match = drawers.find(
      (d) => d.slug === slug || d.label.toLowerCase() === name || slugifyDrawer(d.label) === slug,
    );
    if (!match) continue;
    for (const path of (await referencePaths(match.slug)).slice(0, maxPerSubject)) {
      out.push({ path, label: match.label });
    }
  }
  return out;
}

async function resolveLabelledRefs(
  input: GenerateInput,
  maxPerSubject = MAX_REFS_PER_SUBJECT,
): Promise<LabelledRef[]> {
  const subjectRefs = await resolveSubjectRefs(input.subjects, maxPerSubject);
  const extra = (input.extraRefs ?? [])
    .filter((p) => p && existsSync(p))
    .slice(0, MAX_REFS_PER_SUBJECT)
    .map((path) => ({ path, label: null }));
  return [...subjectRefs, ...extra];
}

async function resolveAllRefs(input: GenerateInput, maxPerSubject = MAX_REFS_PER_SUBJECT): Promise<string[]> {
  return (await resolveLabelledRefs(input, maxPerSubject)).map((r) => r.path);
}

async function newGalleryName(ext = '.png', prefix = 'img'): Promise<string> {
  await fs.mkdir(GALLERY_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}_${stamp}_${crypto.randomBytes(3).toString('hex')}${ext}`;
}

/** Pull the agent's own closing words out of a `codex exec` stdout tail.
 *  Codex prints `[timestamp] codex` before each thing it says and
 *  `[timestamp] tokens used:` at the end; everything else is progress noise.
 *  Used only on the failure path, to give a refusal an actual reason. */
function lastCodexMessage(stdout: string): string {
  const lines = stdout.split(/\r?\n/);
  const spoken: string[] = [];
  let inMessage = false;
  for (const raw of lines) {
    const line = raw.replace(/^\[[^\]]+\]\s*/, '');
    if (/^codex$/i.test(line.trim())) { inMessage = true; spoken.length = 0; continue; }
    if (/^(thinking|exec|tokens used|turn diff)\b/i.test(line.trim())) { inMessage = false; continue; }
    if (inMessage && line.trim()) spoken.push(line.trim());
  }
  const text = (spoken.length ? spoken : lines.map((l) => l.trim()).filter(Boolean).slice(-6)).join(' ');
  return text.replace(/\s+/g, ' ').trim().slice(-500);
}

async function findNewestCodexImage(since: number): Promise<string | null> {
  const root = join(codexHome(), 'generated_images');
  if (!existsSync(root)) return null;
  let best: { path: string; t: number } | null = null;
  const sessions = await fs.readdir(root).catch(() => [] as string[]);
  for (const sess of sessions) {
    const dir = join(root, sess);
    let files: string[];
    try {
      const st = await fs.stat(dir);
      if (!st.isDirectory()) continue;
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!IMAGE_EXTS.has(extname(f).toLowerCase())) continue;
      const p = join(dir, f);
      try {
        const st = await fs.stat(p);
        if (st.mtimeMs >= since - 1000 && (!best || st.mtimeMs > best.t)) {
          best = { path: p, t: st.mtimeMs };
        }
      } catch { /* skip */ }
    }
  }
  return best?.path ?? null;
}

async function findNewestAntigravityImage(since: number): Promise<string | null> {
  const root = join(antigravityHome(), 'brain');
  if (!existsSync(root)) return null;
  let best: { path: string; t: number } | null = null;
  const sessions = await fs.readdir(root).catch(() => [] as string[]);
  for (const sess of sessions) {
    const dir = join(root, sess);
    let files: string[];
    try {
      const st = await fs.stat(dir);
      if (!st.isDirectory()) continue;
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!IMAGE_EXTS.has(extname(f).toLowerCase())) continue;
      const p = join(dir, f);
      try {
        const st = await fs.stat(p);
        if (st.mtimeMs >= since - 1000 && (!best || st.mtimeMs > best.t)) {
          best = { path: p, t: st.mtimeMs };
        }
      } catch { /* skip */ }
    }
  }
  return best?.path ?? null;
}

async function generateViaCodex(input: GenerateInput): Promise<GenerateResult> {
  const start = Date.now();
  const { guidance: sizeDesc } = resolveSize(input);
  const sizeGuidance = sizeDesc ? `Make it ${sizeDesc}.` : '';
  const quality = getImageGenSettings().quality;
  const qualityLine = quality !== 'auto' ? `Render at ${quality} quality and detail.` : '';
  const labelled = await resolveLabelledRefs(input);
  const refs = labelled.map((r) => r.path);

  // Name each attachment in the order it is sent. Without this the renderer
  // gets N unnamed faces and a prompt full of names, and pairs them by guess.
  const refRoster = labelled
    .map((r, i) => `  ${i + 1}. ${r.label ?? 'unnamed reference'}`)
    .join('\n');

  const refLine =
    refs.length > 0
      ? `Reference images are attached in this order:\n${refRoster}\n` +
        `Match each named person in the prompt to THEIR OWN reference above. Never move one person's face, tattoos, scars, facial hair or hair onto another.\n` +
        `REFERENCE USAGE — IDENTITY ONLY: use a reference for face, build, skin, hair and permanent marks. Do NOT inherit its pose, head angle, gaze, expression, wardrobe, crop, camera angle or lighting — the prompt decides all of those.` +
        (pairwiseDistinctions(input.subjects) ? `\n${pairwiseDistinctions(input.subjects)}` : '')
      : '';

  const instruction =
    `Generate ONE image with your built-in image_gen tool.${sizeGuidance ? ' ' + sizeGuidance : ''}${qualityLine ? ' ' + qualityLine : ''}\n` +
    `${refLine}\n` +
    `Use ONLY the built-in image_gen tool. Do NOT use any CLI, API, or OPENAI_API_KEY path.\n\n` +
    `--- PROMPT ---\n${input.prompt}\n--- END PROMPT ---\n\n` +
    `After it is saved, output as the final line exactly: RESULT_PATH=<absolute path>`;

  // Use the requested model, or gpt-5.6-terra. This used to fall back to
  // gpt-5.4, which left ChatGPT-signed Codex on Aug 31 2026, so a request
  // naming no model failed here and was handed down the fallback chain with
  // nobody told.
  const codexModel = input.codexModel || 'gpt-5.6-terra';

  const args = [
    'exec',
    '--skip-git-repo-check',
    '-c', `model="${codexModel}"`,
    ...refs.flatMap((r) => ['-i', r]),
    '-',
  ];

  const bin = codexBin();
  const env = {
    ...process.env,
    PATH: `/opt/node/bin:${process.env.PATH || ''}`,
    HOME: process.env.HOME || homedir(),
  };

  const produced = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { env });
    let stderr = '';
    let stdout = '';
    let settled = false;
    let lastSize = -1;
    let stableHits = 0;
    let foundPath: string | null = null;
    let stdoutPath: string | null = null;

    const noteStdout = (chunk: string) => {
      // Always drain stdout. Codex can emit enough progress text to backpressure
      // an unconsumed pipe, which makes Studio feel much slower than interactive
      // Codex runs. Keep only a small tail for RESULT_PATH parsing.
      stdout = (stdout + chunk).slice(-20_000);
      const match = stdout.match(/RESULT_PATH=(\/[^\r\n]+)/);
      if (match?.[1]) stdoutPath = match[1].trim();
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      clearInterval(poll);
      fn();
    };

    const killer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      settle(() => reject(new ImageGenError('Image generation timed out (10 min).')));
    }, 600_000);

    const checkForImage = () => {
      void (async () => {
        try {
          const p = foundPath ?? stdoutPath ?? (await findNewestCodexImage(start));
          if (!p) return;
          foundPath = p;
          const sz = (await fs.stat(p)).size;
          if (sz > 0 && sz === lastSize) {
            if (++stableHits >= 2) {
              try { child.kill('SIGTERM'); } catch { /* ignore */ }
              settle(() => resolve(p));
            }
          } else {
            lastSize = sz;
            stableHits = 0;
          }
        } catch { /* keep polling */ }
      })();
    };

    const poll = setInterval(checkForImage, 500);

    child.stdin.write(instruction);
    child.stdin.end();
    child.stdout.on('data', (d) => { noteStdout(String(d)); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    checkForImage();
    child.on('error', (err) => {
      settle(() => reject(new ImageGenError(`Could not run codex CLI (${bin}): ${err.message}`)));
    });
    child.on('close', async (code) => {
      const p = stdoutPath ?? (await findNewestCodexImage(start).catch(() => null));
      if (p) settle(() => resolve(p));
      else {
        // When Codex declines a prompt it usually exits 0 and says why on
        // stdout — stderr is empty. Reporting stderr alone leaves the owner
        // with a blank reason, so fall back to the tail of what it actually
        // said before giving up.
        const said = stderr.trim() || lastCodexMessage(stdout);
        settle(() => reject(new ImageGenError(
          said
            ? `Codex finished without an image. It said: ${said}`
            : `codex exec exited ${code} with no image and gave no reason.`,
        )));
      }
    });
  });

  const filename = await newGalleryName();
  const dest = join(GALLERY_DIR, filename);
  await fs.copyFile(produced, dest);

  return {
    filename,
    path: dest,
    backend: 'codex',
    model: codexModel,
    durationMs: Date.now() - start,
    costUsd: 0,
  };
}

async function generateViaAntigravity(input: GenerateInput): Promise<GenerateResult> {
  const start = Date.now();
  const { guidance: sizeDesc } = resolveSize(input);
  const sizeGuidance = sizeDesc ? ` Make it ${sizeDesc}.` : '';
  const refs = await resolveAllRefs(input);

  // Build reference instruction if refs exist
  const refLine = refs.length > 0
    ? `Use these reference images to maintain character/subject consistency: ${refs.join(', ')}. `
    : '';

  const instruction = `${refLine}generate an image of: ${input.prompt}${sizeGuidance}`;

  const bin = antigravityBin();
  if (!existsSync(bin)) {
    throw new ImageGenError(`Antigravity CLI not found at ${bin}. Install with: curl -fsSL https://antigravity.google/cli/install.sh | bash`);
  }

  const env = {
    ...process.env,
    PATH: `${join(homedir(), '.local', 'bin')}:${process.env.PATH || ''}`,
    HOME: process.env.HOME || homedir(),
  };

  // Use request model if provided, otherwise fall back to configured default
  // Only Gemini models can generate images — Claude/GPT models can't
  const settings = getImageGenSettings();
  const model = (input.agyModel && ANTIGRAVITY_MODELS.includes(input.agyModel as AntigravityModel))
    ? input.agyModel
    : settings.antigravityModel;

  const produced = await new Promise<string>((resolve, reject) => {
    // Run from /tmp to avoid agy getting confused by workspace context
    // agy's print mode accepts its prompt as the final positional argument; it does
    // not read prompts from stdin. Keep every flag before --print, otherwise it
    // mistakes a later flag (such as --print-timeout) for the prompt.
    const child = spawn(bin, ['--model', model, '--print-timeout', '10m', '--print', instruction], { env, cwd: '/tmp', stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    let settled = false;
    let lastSize = -1;
    let stableHits = 0;
    let foundPath: string | null = null;

    const noteStdout = (chunk: string) => {
      // Drain stdout so agy cannot block on a full pipe during long generations.
      stdout = (stdout + chunk).slice(-20_000);
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      clearInterval(poll);
      fn();
    };

    const killer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      settle(() => reject(new ImageGenError('Image generation timed out (10 min).')));
    }, 600_000);

    const checkForImage = () => {
      void (async () => {
        try {
          const p = foundPath ?? (await findNewestAntigravityImage(start));
          if (!p) return;
          foundPath = p;
          const sz = (await fs.stat(p)).size;
          if (sz > 0 && sz === lastSize) {
            if (++stableHits >= 2) {
              try { child.kill('SIGTERM'); } catch { /* ignore */ }
              settle(() => resolve(p));
            }
          } else {
            lastSize = sz;
            stableHits = 0;
          }
        } catch { /* keep polling */ }
      })();
    };

    const poll = setInterval(checkForImage, 500);

    child.stdout.on('data', (d) => { noteStdout(String(d)); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    checkForImage();
    child.on('error', (err) => {
      settle(() => reject(new ImageGenError(`Could not run agy CLI (${bin}): ${err.message}`)));
    });
    child.on('close', async (code) => {
      const p = await findNewestAntigravityImage(start).catch(() => null);
      if (p) settle(() => resolve(p));
      else settle(() => reject(new ImageGenError(`agy exited ${code} with no image. ${stderr.slice(-400)}`)));
    });
  });

  const filename = await newGalleryName();
  const dest = join(GALLERY_DIR, filename);
  await fs.copyFile(produced, dest);

  return {
    filename,
    path: dest,
    backend: 'antigravity' as const,
    model,
    durationMs: Date.now() - start,
    costUsd: 0,
  };
}

// ─── OpenArt (direct MCP-over-HTTP) ──────────────────────────────────
// The `openart` MCP server is OAuth-logged-in at the Codex level
// (`codex mcp login openart`); the token lives in ~/.codex/.credentials.json.
// We speak JSON-RPC to mcp.openart.ai ourselves rather than through a codex
// exec agent — codex sessions silently omit openart_upload_sign from the
// callable schema, so an agent can never upload references. The backend
// refreshes the token in place when it expires; codex picks up the refresh
// from the same file.

/** OpenArt model ids that produce video. kling-3-omni does both; the
 *  request's openartMedia decides which mode family it runs in. */
const OPENART_VIDEO_ONLY = new Set([
  'grok-imagine-1-5', 'gemini-omni-flash', 'wan2-7', 'pixverseV6',
  'byte-plus-seedance-2', 'byte-plus-seedance-2-fast', 'byte-plus-seedance-2-mini',
]);

/** Models whose only video mode is image2video (no element/text modes). */
const OPENART_I2V_ONLY = new Set(['grok-imagine-1-5']);
/** Models without element2video — fall back to image2video when refs exist. */
const OPENART_NO_ELEMENT = new Set(['pixverseV6', 'grok-imagine-1-5']);

function openartMode(media: 'image' | 'video', model: string, hasRefs: boolean): string {
  if (media === 'image') return hasRefs ? 'image2image' : 'text2image';
  if (OPENART_I2V_ONLY.has(model)) return 'image2video';
  if (!hasRefs) return 'text2video';
  return OPENART_NO_ELEMENT.has(model) ? 'image2video' : 'element2video';
}

function contentTypeFor(file: string): string {
  const ext = extname(file).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

interface OpenArtCredEntry {
  server_url: string;
  client_id: string;
  access_token: string;
  expires_at: number;
  refresh_token: string;
}

/** Load the OpenArt bearer token from codex's credential store, refreshing
 *  it in place when it is about to expire. */
async function openartAuth(): Promise<{ url: string; token: string }> {
  const credFile = join(codexHome(), '.credentials.json');
  let creds: Record<string, OpenArtCredEntry>;
  try {
    creds = JSON.parse(await fs.readFile(credFile, 'utf8'));
  } catch {
    throw new ImageGenError('OpenArt is not logged in — run `codex mcp login openart` first.');
  }
  const key = Object.keys(creds).find((k) => k.startsWith('openart|'));
  if (!key) throw new ImageGenError('OpenArt is not logged in — run `codex mcp login openart` first.');
  const entry = creds[key];
  if (Number(entry.expires_at) < Date.now() + 60_000) {
    const resp = await fetch('https://openart.ai/suite/api/auth/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: entry.refresh_token,
        client_id: entry.client_id,
      }).toString(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      throw new ImageGenError(`OpenArt token refresh failed (${resp.status}) — re-run \`codex mcp login openart\`.`);
    }
    const t = await resp.json() as { access_token: string; refresh_token?: string; expires_in?: number };
    entry.access_token = t.access_token;
    if (t.refresh_token) entry.refresh_token = t.refresh_token;
    entry.expires_at = Date.now() + (t.expires_in ? t.expires_in * 1000 : 3600_000);
    creds[key] = entry;
    await fs.writeFile(credFile, JSON.stringify(creds, null, 2));
  }
  return { url: entry.server_url || 'https://mcp.openart.ai/mcp', token: entry.access_token };
}

/** One MCP tools/call round-trip; returns the joined text content. */
async function openartCall(name: string, args: Record<string, unknown>): Promise<string> {
  const { url, token } = await openartAuth();
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!resp.ok) throw new ImageGenError(`OpenArt MCP ${name}: HTTP ${resp.status}.`);
  let raw = await resp.text();
  for (const line of raw.split('\n')) {
    if (line.startsWith('data:')) { raw = line.slice(5); break; }
  }
  const parsed = JSON.parse(raw) as {
    error?: { message?: string };
    result?: { isError?: boolean; content?: Array<{ type: string; text?: string }> };
  };
  if (parsed.error) throw new ImageGenError(`OpenArt ${name}: ${parsed.error.message || 'MCP error'}`);
  const text = (parsed.result?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
  if (parsed.result?.isError) throw new ImageGenError(`OpenArt ${name}: ${text.slice(0, 300)}`);
  return text;
}

/** Tool replies mix a JSON payload with prose instructions; dig the JSON out. */
function parseFirstJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text); } catch { /* fall through to per-line */ }
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try { return JSON.parse(t); } catch { /* keep looking */ }
  }
  return null;
}

/** Flatten a model form's jsonSchema (allOf layers) into properties + required.
 *  Some forms route property schemas through $defs — resolve one $ref level. */
function collectFormProps(form: Record<string, unknown> | null, mode: string): {
  props: Record<string, Record<string, unknown>>;
  required: Set<string>;
} {
  const props: Record<string, Record<string, unknown>> = {};
  const required = new Set<string>();
  type SchemaNode = Record<string, unknown>;
  const schema = form?.jsonSchema as SchemaNode | undefined;
  const defs = schema?.$defs ?? {};
  const resolve = (value: SchemaNode): SchemaNode => {
    let node = value;
    const seen = new Set<string>();
    while (typeof node?.$ref === 'string' && node.$ref.startsWith('#/$defs/')) {
      const key = node.$ref.slice('#/$defs/'.length);
      if (seen.has(key)) break;
      seen.add(key);
      const next = defs[key];
      if (!next || typeof next !== 'object') break;
      node = next as SchemaNode;
    }
    return node;
  };

  // OpenArt's element-video forms are frequently discriminated unions rather
  // than flat objects. Pick the element + single-shot branch instead of
  // merging mutually exclusive branches (which produces an impossible form).
  const desiredCreationMode = mode === 'element2video' ? 'element' : 'text';
  const branchScore = (value: SchemaNode): number => {
    const node = resolve(value);
    const p = (node.properties ?? {}) as Record<string, SchemaNode>;
    let score = 0;
    const creation = p.creationMode ? resolve(p.creationMode).const : undefined;
    if (creation === desiredCreationMode) score += 100;
    else if (creation !== undefined) score -= 100;
    const multiShot = p.multiShot ? resolve(p.multiShot).const : undefined;
    if (multiShot === false) score += 10;
    else if (multiShot === true) score -= 10;
    return score;
  };
  const visit = (value: SchemaNode): void => {
    const node = resolve(value);
    const nodeProps = (node.properties ?? {}) as Record<string, SchemaNode>;
    for (const [name, prop] of Object.entries(nodeProps)) props[name] = resolve(prop);
    for (const name of (node.required ?? []) as string[]) required.add(name);
    for (const child of (node.allOf ?? []) as SchemaNode[]) visit(child);
    const variants = ((node.oneOf ?? node.anyOf) ?? []) as SchemaNode[];
    if (variants.length) {
      const selected = variants.reduce((best, candidate) =>
        branchScore(candidate) > branchScore(best) ? candidate : best,
      );
      visit(selected);
    }
  };
  if (schema) visit(schema);
  return { props, required };
}

/** Pick the enum aspect ratio closest to the requested pixel size. */
function closestAspect(options: unknown, apiSize: string): string {
  const opts = Array.isArray(options) ? options.filter((o): o is string => typeof o === 'string') : [];
  if (!opts.length) return '1:1';
  const [w, h] = apiSize.split('x').map(Number);
  const target = w && h ? w / h : 1;
  let best = opts[0];
  let bestDiff = Infinity;
  for (const opt of opts) {
    const [ow, oh] = opt.split(':').map(Number);
    if (!ow || !oh) continue;
    const diff = Math.abs(ow / oh - target);
    if (diff < bestDiff) { bestDiff = diff; best = opt; }
  }
  return best;
}

async function generateViaOpenArt(input: GenerateInput): Promise<GenerateResult> {
  const start = Date.now();
  const settings = getImageGenSettings();
  const model = input.openartModel || settings.openartModel;
  const media: 'image' | 'video' =
    input.openartMedia || (OPENART_VIDEO_ONLY.has(model) ? 'video' : 'image');
  // A video model needs one distinct element per selected subject, not two
  // alternate portraits of the same subject. Sending both drawer images made
  // Seedance treat one person as two visual elements (and sometimes reject
  // visualRef outright); it also let I2V models choose the weaker likeness as
  // their opening frame.
  const refs = await resolveAllRefs(input, media === 'video' ? 1 : MAX_REFS_PER_SUBJECT);
  if (OPENART_I2V_ONLY.has(model) && refs.length === 0) {
    throw new ImageGenError(`${model} is image-to-video only — select at least one reference subject.`);
  }
  const mode = openartMode(media, model, refs.length > 0);
  const { apiSize } = resolveSize(input);

  // Upload each reference ourselves: sign, PUT the bytes, keep the handle.
  const visualReferences: Array<Record<string, unknown>> = [];
  for (const ref of refs) {
    const bytes = await fs.readFile(ref);
    const ct = contentTypeFor(ref);
    const sign = parseFirstJson(await openartCall('openart_upload_sign', {
      mediaType: 'image', size: bytes.length, contentType: ct, purpose: `create-${media}`,
    })) as { uploadId?: string; signURL?: string; accessURL?: string } | null;
    if (!sign?.signURL || !sign.uploadId) throw new ImageGenError('OpenArt upload_sign returned no signed URL.');
    const put = await fetch(sign.signURL, {
      method: 'PUT',
      headers: { 'Content-Type': ct },
      body: bytes,
      signal: AbortSignal.timeout(300_000),
    });
    if (!put.ok) throw new ImageGenError(`OpenArt reference upload failed (${put.status}).`);
    let visualReference: Record<string, unknown> = {
      type: 'image', id: sign.uploadId, url: sign.accessURL,
      label: basename(ref),
    };
    // Element-video adapters (notably Seedance and Kling) validate the source
    // dimensions and file size even though some published schemas do not mark
    // metadata required. Ask OpenArt to probe the completed upload and use its
    // canonical reference object. I2V startFrame is narrowed back to four
    // fields below because Grok explicitly forbids metadata there.
    if (media === 'video') {
      let probed: Record<string, unknown> | null = null;
      for (let attempt = 0; attempt < 5 && !probed; attempt++) {
        if (attempt) await new Promise((resolve) => setTimeout(resolve, 1_000));
        try {
          const metadata = parseFirstJson(await openartCall('openart_upload_metadata_get', {
            mediaType: 'image', mediaUrl: sign.accessURL,
            uploadId: sign.uploadId, label: basename(ref),
          }));
          const candidate = metadata?.visualReference;
          if (candidate && typeof candidate === 'object') probed = candidate as Record<string, unknown>;
        } catch { /* the freshly uploaded asset may still be processing */ }
      }
      if (!probed) throw new ImageGenError('OpenArt could not read the uploaded reference metadata.');
      visualReference = probed;
    }
    visualReferences.push(visualReference);
  }

  // Ask the form what this model/mode takes and fill it deterministically.
  const form = parseFirstJson(await openartCall('openart_model_form_get', { model, mode }));
  const { props, required } = collectFormProps(form, mode);
  const params: Record<string, unknown> = { prompt: input.prompt };
  if (props.imageCount) params.imageCount = 1;
  if (props.aspectRatio) params.aspectRatio = closestAspect(props.aspectRatio.enum, apiSize);
  if (props.visualReferences) {
    if (visualReferences.length) params.visualReferences = visualReferences;
    else if (required.has('visualReferences')) params.visualReferences = [];
  }
  // image2video forms take a single startFrame object with a strict shape
  // ({type,id,url,label} only — additionalProperties:false rejects extras).
  if (props.startFrame && visualReferences.length) {
    const first = visualReferences[0];
    params.startFrame = { type: 'image', id: first.id, url: first.url, label: 'start frame' };
  }
  const formDefaults = (form?.defaults ?? {}) as Record<string, unknown>;
  for (const [name, schema] of Object.entries(props)) {
    if (name in params || !required.has(name)) continue;
    if ('default' in schema) params[name] = schema.default;
    else if (name in formDefaults) params[name] = formDefaults[name];
    else if ('const' in schema) params[name] = schema.const;
    else if (Array.isArray(schema.enum) && schema.enum.length) params[name] = schema.enum[0];
  }

  const timeoutMs = media === 'video' ? 900_000 : 480_000;
  const genText = await openartCall(
    media === 'video' ? 'openart_generate_video' : 'openart_generate_image',
    { model, mode, params },
  );
  const gen = parseFirstJson(genText) as { status?: string; historyId?: string; error?: string } | null;
  if (!gen?.historyId || gen.historyId === 'submit-failed' || gen.status === 'FAILED') {
    throw new ImageGenError(`OpenArt rejected the generation: ${gen?.error || genText.slice(0, 300)}`);
  }

  interface WaitStatus { status?: string; error?: string; resources?: Array<{ url?: string }> }
  let done: WaitStatus | null = null;
  let blanks = 0;
  while (Date.now() - start < timeoutMs) {
    const w = parseFirstJson(await openartCall('openart_creation_wait', {
      historyId: gen.historyId, timeoutSeconds: 90,
    })) as WaitStatus | null;
    if (!w) {
      if (++blanks >= 3) throw new ImageGenError('OpenArt stopped returning parseable status.');
      continue;
    }
    blanks = 0;
    if (w.status === 'COMPLETED') { done = w; break; }
    if (w.status === 'FAILED' || w.status === 'CANCELLED') {
      throw new ImageGenError(`OpenArt generation ${w.status.toLowerCase()}: ${w.error || 'no reason given'}`);
    }
  }
  if (!done) throw new ImageGenError(`OpenArt generation timed out (${Math.round(timeoutMs / 60000)} min).`);
  const url = done.resources?.[0]?.url;
  if (!url) throw new ImageGenError('OpenArt finished but returned no resource URL.');

  const resp = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!resp.ok) throw new ImageGenError(`Could not download OpenArt result (${resp.status}).`);
  const buf = Buffer.from(await resp.arrayBuffer());

  const urlExt = extname(new URL(url).pathname).toLowerCase();
  const ext = (media === 'video')
    ? (VIDEO_EXTS.has(urlExt) ? urlExt : '.mp4')
    : (IMAGE_EXTS.has(urlExt) ? urlExt : '.png');
  const filename = await newGalleryName(ext, media === 'video' ? 'vid' : 'img');
  const dest = join(GALLERY_DIR, filename);
  await fs.writeFile(dest, buf);

  return {
    filename,
    path: dest,
    backend: 'openart',
    model,
    mediaType: media,
    durationMs: Date.now() - start,
    costUsd: 0,
  };
}

function estimateOpenAiCost(size: string): number {
  if (size === '1024x1024') return 0.07;
  return 0.1;
}

async function generateViaOpenAi(input: GenerateInput): Promise<GenerateResult> {
  const start = Date.now();
  const key = getConfig('image_gen.openai_api_key');
  if (!key) throw new ImageGenError('OpenAI backend selected but no API key is set in Studio settings.');
  const { openaiModel: model, quality } = getImageGenSettings();
  const { apiSize } = resolveSize(input);
  const refs = await resolveAllRefs(input);

  let b64: string | undefined;
  if (refs.length > 0) {
    const form = new FormData();
    form.set('model', model);
    form.set('prompt', input.prompt);
    form.set('size', apiSize);
    if (quality !== 'auto') form.set('quality', quality);
    for (const r of refs.slice(0, 4)) {
      const buf = await fs.readFile(r);
      form.append('image[]', new Blob([buf]), basename(r));
    }
    const resp = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    const data = (await resp.json()) as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
    if (!resp.ok) throw new ImageGenError(`OpenAI edits failed: ${data.error?.message || resp.status}`);
    b64 = data.data?.[0]?.b64_json;
  } else {
    const genBody: Record<string, unknown> = { model, prompt: input.prompt, size: apiSize, n: 1 };
    if (quality !== 'auto') genBody.quality = quality;
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(genBody),
      signal: AbortSignal.timeout(180_000),
    });
    const data = (await resp.json()) as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
    if (!resp.ok) throw new ImageGenError(`OpenAI generation failed: ${data.error?.message || resp.status}`);
    b64 = data.data?.[0]?.b64_json;
  }

  if (!b64) throw new ImageGenError('OpenAI returned no image data.');
  const filename = await newGalleryName();
  const dest = join(GALLERY_DIR, filename);
  await fs.writeFile(dest, Buffer.from(b64, 'base64'));

  return {
    filename,
    path: dest,
    backend: 'openai',
    model,
    durationMs: Date.now() - start,
    costUsd: estimateOpenAiCost(apiSize),
  };
}

/** Only the metered backend is capped, and only when the owner has set a figure. */
export function budgetApplies(backend: string, monthlyBudgetUsd: number): boolean {
  return backend === 'openai' && monthlyBudgetUsd > 0;
}

/**
 * Whether to refuse, and why. Pure so it can be tested.
 *
 * NULL SPEND MEANS THE METER IS UNREADABLE, NOT THAT NOTHING WAS SPENT, and it
 * must refuse. The old code could not tell those apart: its query named a
 * column that has never existed, threw every time, and a catch reported zero —
 * so the cap silently never fired on the one path in this house that bills.
 */
export function budgetRefusal(spentUsd: number | null, monthlyBudgetUsd: number): string | null {
  if (spentUsd === null) {
    return 'A monthly image budget is set, but the house cannot read what has been spent, so the cap cannot be honoured. '
      + 'Clear the budget to generate without one, or switch to the free Codex backend.';
  }
  if (spentUsd >= monthlyBudgetUsd) {
    return `Monthly image budget reached ($${spentUsd.toFixed(2)} / $${monthlyBudgetUsd.toFixed(2)}). `
      + 'Raise it in Studio settings or switch to the free Codex backend.';
  }
  return null;
}

export async function generateImage(input: GenerateInput): Promise<GenerateResult> {
  const settings = getImageGenSettings();
  if (!settings.enabled) {
    throw new ImageGenError('Image generation is switched off. Turn it on in Studio Settings.');
  }
  if (!input.prompt || !input.prompt.trim()) {
    throw new ImageGenError('A prompt is required to generate an image.');
  }

  if (budgetApplies(settings.backend, settings.monthlyBudgetUsd)) {
    const refusal = budgetRefusal(await monthlySpendUsd(), settings.monthlyBudgetUsd);
    if (refusal) throw new ImageGenError(refusal);
  }

  // Use request backend override if provided, otherwise use settings
  // An unknown name has always fallen through to codex here; keep that, but
  // narrow it once rather than letting a loose string reach the chain.
  const requested = input.backend || settings.backend;
  const effectiveBackend: ImageBackend = (KNOWN_BACKENDS as string[]).includes(requested)
    ? (requested as ImageBackend)
    : 'codex';

  // Nothing here asks a backend whether it is ready — that flag describes
  // configuration and lied through a total outage. Giving it the job is the
  // only honest test, so the chain simply tries them in order.
  const outcome = await runWithFallback(
    planAttempts(effectiveBackend, settings.fallbackChain),
    (backend) => runOnBackend(backend, { ...input, backend }),
  );
  return outcome.failed.length > 0
    ? { ...outcome.result, fellBackFrom: outcome.failed }
    : outcome.result;
}

function runOnBackend(backend: ImageBackend, input: GenerateInput): Promise<GenerateResult> {
  if (backend === 'openai') return generateViaOpenAi(input);
  if (backend === 'antigravity') return generateViaAntigravity(input);
  if (backend === 'openart') return generateViaOpenArt(input);
  return generateViaCodex(input);
}

/** NULL means the house cannot tell, which is not the same as zero. */
export function monthlyImageSpendUsd(): Promise<number | null> {
  return monthlySpendUsd();
}

/**
 * What has been spent on image generation this month, or NULL when it cannot
 * be told.
 *
 * IT USED TO RETURN 0 WHEN IT COULD NOT TELL, which is the whole reason this
 * comment exists. The query asked for a column named `engine` on usage_events,
 * which has never existed; it threw on every call and a catch turned the throw
 * into "nothing has been spent". A budget that cannot be exceeded is not a
 * budget, and the caller had no way to know the difference.
 *
 * Absent is not false. If nothing in a given install writes an image generation
 * into usage_events with a cost on it, the honest answer to "how much have we
 * spent" is that we do not know, and the caller must decide what to do about
 * not knowing.
 */
async function monthlySpendUsd(): Promise<number | null> {
  try {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const row = getDb()
      .prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) AS spent, COUNT(*) AS rows FROM usage_events
         WHERE model = ? AND created_at >= ?`,
      )
      .get(IMAGE_GEN_ENGINE, monthStart.toISOString()) as { spent: number; rows: number } | undefined;
    if (!row || row.rows === 0) return null;
    return row.spent;
  } catch {
    return null;
  }
}

// ─── Async Job Pattern ───────────────────────────────────────────────
// Jobs are persisted so leaving Studio never loses the status. A server restart
// does not silently re-run a paid/slow request: incomplete jobs are marked
// interrupted and shown honestly to the phone instead.

export interface ImageJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: GenerateInput;
  result?: GenerateResult;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

const jobs = new Map<string, ImageJob>();
let generationQueue: Promise<void> = Promise.resolve();

function persistJobs(): void {
  try {
    writeFileSync(JOBS_FILE, JSON.stringify([...jobs.values()], null, 2));
  } catch (error) {
    console.warn('[image-gen] could not persist job status:', error);
  }
}

function restoreJobs(): void {
  try {
    if (!existsSync(JOBS_FILE)) return;
    const saved = JSON.parse(readFileSync(JOBS_FILE, 'utf8')) as ImageJob[];
    for (const item of saved) {
      if (!item?.id || !item.status) continue;
      if (item.status === 'pending' || item.status === 'running') {
        item.status = 'failed';
        item.error = 'Aerie restarted before this image finished. Please run it again.';
        item.completedAt = Date.now();
      }
      jobs.set(item.id, item);
    }
    persistJobs();
  } catch (error) {
    console.warn('[image-gen] could not restore job status:', error);
  }
}
if (process.env.NODE_ENV !== 'test') restoreJobs();

// Cleanup old finished jobs after 24 hours. Active work is always retained.
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const jobCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.status !== 'pending' && job.status !== 'running' && (job.completedAt ?? job.createdAt) < cutoff) jobs.delete(id);
  }
  persistJobs();
}, 60_000);
jobCleanupTimer.unref();

export function getJobStatus(id: string): ImageJob | undefined {
  return jobs.get(id);
}

export function listImageJobs(): ImageJob[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function startGenerateJob(input: GenerateInput, onComplete?: (result: GenerateResult) => Promise<void> | void): string {
  const settings = getImageGenSettings();
  if (!settings.enabled) throw new ImageGenError('Image generation is switched off. Turn it on in Studio Settings.');
  if (!input.prompt || !input.prompt.trim()) throw new ImageGenError('A prompt is required to generate an image.');

  const id = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const job: ImageJob = { id, status: 'pending', input, createdAt: Date.now() };
  jobs.set(id, job);
  persistJobs();

  // One Studio image at a time: chat remains free, and Studio cannot pile up
  // competing Codex processes behind the user's back.
  generationQueue = generationQueue.catch(() => undefined).then(async () => {
    job.status = 'running';
    persistJobs();
    try {
      const result = await generateImage(input);
      try {
        await onComplete?.(result);
      } catch (error) {
        // The image exists even if its gallery index write hiccups. Never turn
        // a successful render into a fake failure because its filing failed.
        console.warn('[image-gen] gallery metadata write failed:', error);
      }
      job.status = 'completed';
      job.result = result;
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
    } finally {
      job.completedAt = Date.now();
      persistJobs();
    }
  });

  return id;
}
