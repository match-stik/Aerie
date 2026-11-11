// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { promises as fs } from 'fs';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';
import { type AttemptRecord } from '../image-fallback.js';
import { ASPECT_RATIOS, GALLERY_DIR, REFS_DIR, SIZE_MAP, getImageGenSettings } from './settings.js';
import { listDrawers, referencePaths, sanitizeSlug, slugifyDrawer } from './drawers.js';

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

export function resolveSize(input: GenerateInput): { guidance: string; apiSize: string } {
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

export const MAX_REFS_PER_SUBJECT = 2;

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

/** The Codex model a picture is drawn on when the request names none, and the
 *  one every bell is told to ask for. Terra on purpose: which Codex model a
 *  house draws on is a fact about its owner's own plan, and Astra needs Codex
 *  CLI 0.153.0 or later and costs about two to three times Terra per picture.
 *  The Studio picker still sends whatever their person chose. */
export const DEFAULT_CODEX_IMAGE_MODEL = 'gpt-5.6-terra';

/** The file in a drawer that holds what its photos cannot. */
export const BUILD_NOTE_FILE = 'build.txt';
const BUILD_NOTE_MAX = 300;

/**
 * Height and build, for each subject in the frame whose drawer keeps a note.
 *
 * A reference photo carries a face and never a height: every photo in one
 * house's drawers was somebody leaning back on a couch, so the renderer
 * guessed, and subjects of different heights and builds came out
 * interchangeable. One
 * plain line in the drawer's build.txt, written by hand, says what the photo
 * cannot. A drawer without one adds nothing, so a fresh install says nothing.
 * Read per request, so an edit needs no restart.
 */
export function subjectBuildNotes(
  subjects: string[] | undefined,
  opts: { refsDir?: string; drawers?: ReadonlyArray<{ slug: string; label: string }> } = {},
): string {
  if (!subjects || subjects.length === 0) return '';
  const refsDir = opts.refsDir ?? REFS_DIR;
  const drawers = opts.drawers ?? listDrawers();
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const raw of subjects) {
    const name = String(raw).toLowerCase().trim();
    const slug = sanitizeSlug(name);
    const drawer = drawers.find(
      (d) => d.slug === slug || d.label.toLowerCase() === name || slugifyDrawer(d.label) === slug,
    );
    if (!drawer || seen.has(drawer.slug)) continue;
    seen.add(drawer.slug);
    let note = '';
    try {
      note = readFileSync(join(refsDir, drawer.slug, BUILD_NOTE_FILE), 'utf8');
    } catch {
      continue;
    }
    note = note.replace(/\s+/g, ' ').trim().slice(0, BUILD_NOTE_MAX);
    if (note) lines.push(`  - ${drawer.label}: ${note}`);
  }
  if (lines.length === 0) return '';
  return (
    'HEIGHT AND BUILD — no reference photo can show these, so keep them true, and keep them true relative to each other when people stand together:\n' +
    lines.join('\n')
  );
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

export async function resolveLabelledRefs(
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

export async function resolveAllRefs(input: GenerateInput, maxPerSubject = MAX_REFS_PER_SUBJECT): Promise<string[]> {
  return (await resolveLabelledRefs(input, maxPerSubject)).map((r) => r.path);
}

export async function newGalleryName(ext = '.png', prefix = 'img'): Promise<string> {
  await fs.mkdir(GALLERY_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}_${stamp}_${crypto.randomBytes(3).toString('hex')}${ext}`;
}
