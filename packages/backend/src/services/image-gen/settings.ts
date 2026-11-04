// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { PROJECT_ROOT } from '../../config.js';
import { getConfig, getConfigBool, getConfigNumber } from '../db/config.js';
import { getSecret } from '../secrets.js';
import { parseFallbackChain, type ImageBackend } from '../image-fallback.js';
import { isSafeSubjectSlug } from './drawers.js';

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
export function discoveredDrawers(): Array<{ slug: string; label: string }> {
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

export const DATA_DIR = join(PROJECT_ROOT, 'data');
export const REFS_DIR = join(DATA_DIR, 'image-refs');
export const GALLERY_DIR = join(DATA_DIR, 'generated-images');
// Every queued job rewrites this file, so a test that queues one must point it
// somewhere disposable — run in the house's own tree, it would otherwise
// replace the live record of every picture in flight.
export const JOBS_FILE = process.env.AERIE_STUDIO_JOBS_FILE || join(DATA_DIR, 'studio-image-jobs.json');

export const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
export const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov']);

export const SIZE_MAP: Record<string, { guidance: string; apiSize: string }> = {
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

/** The one that has actually been seen to take a picture. Defined once because a
 *  duplicated default drifts even when both copies start out identical. agy
 *  stopped offering Gemini 3.1 Pro by Oct 2026 ('invalid model selection'),
 *  so every refused Codex job skipped this painter; 3.8 Flash (High) draws. */
export const ANTIGRAVITY_DEFAULT_MODEL = 'Gemini 3.8 Flash (High)' as const;

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

export const ANTIGRAVITY_DEFAULT_TIMEOUT_SECONDS = 150;

/** Seconds Antigravity gets, from image_gen.antigravity_timeout_seconds; a
 *  missing or nonsense value means the default, and it is held between half a
 *  minute and ten. */
export function antigravityTimeoutMs(raw: unknown = getConfig('image_gen.antigravity_timeout_seconds')): number {
  const n = Number(raw);
  const seconds = Number.isFinite(n) && n > 0 ? Math.min(600, Math.max(30, n)) : ANTIGRAVITY_DEFAULT_TIMEOUT_SECONDS;
  return seconds * 1000;
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

export function codexBin(): string {
  // Do not pin Studio to the binary nested inside a particular npm package
  // version. `codex update` installs the current standalone CLI in ~/.local/bin.
  // PM2's deliberately minimal PATH does not include that directory, so resolve
  // the standalone install directly rather than relying on command lookup.
  return getConfig('image_gen.codex_bin') || process.env.CODEX_BIN || join(homedir(), '.local', 'bin', 'codex');
}

export function codexHome(): string {
  return getConfig('image_gen.codex_home') || process.env.CODEX_HOME || join(homedir(), '.codex');
}

export function antigravityHome(): string {
  return getConfig('image_gen.antigravity_home') || join(homedir(), '.gemini', 'antigravity-cli');
}

export function antigravityBin(): string {
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
