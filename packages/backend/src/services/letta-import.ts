// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// services/letta-import.ts — bring a Letta companion's memory into this house.
//
// Letta Code keeps an agent's memory as a folder of markdown files (its
// "memory filesystem"), one file per memory, named for the memory's label,
// each with a short YAML header (name, description) over the text. `letta
// memory export` writes that folder anywhere. Older agents keep the always-on
// memories under system/. Folders with their own MEMORY.md index are kept out
// of the prompt until needed, and skills/ holds the agent's skills.
//
// That is nearly the shape of this house's own walls (a label, a scope and the
// text), so the mapping is direct:
//   - a memory at the root (or under system/) becomes a wall on the chosen
//     companion; `human` lands on the shared human wall, because in this house
//     the person is written down once for everybody;
//   - a memory in any other folder (reference/ and the like) is the "findable,
//     not in hand" kind, so it goes to Cortex in the companion's own drawer;
//   - MEMORY.md indexes and skills are reported and left alone.
// Nothing is ever overwritten: a wall that already has words gets the import
// appended under a dated line, so a mistake is one edit away from undone.
//
// THREE DOORS:
//   - new: the Letta companion arrives as a companion of their own, with their
//     own walls; even what they know about the person stays on their own side,
//     so nothing lands on anybody already here.
//   - merge: onto a companion already here, and the person picks per memory:
//     add it to the wall of the same name, make it a wall of its own, put it
//     in the drawer, or leave it. The human file asks separately whether it
//     joins the shared wall about the person or stays on this companion's side.
//   - drawer: onto a companion already here, findable only: everything goes to
//     Cortex and no wall is touched.
// Found by a real export the same night (a Letta Code agent on Haiku, told a
// few things and exported): the agent wrote what it learned into the root
// MEMORY.md, which this file used to skip as an index, and its human file was
// still Letta's untouched starter text, which used to land on the person's
// wall. A MEMORY.md is an index only when it reads like one now, and starter
// text is recognised and left behind.

import * as yaml from 'js-yaml';
import * as memoryBlocks from './memory-blocks.js';
import { rememberThought } from './cortex.js';

export interface LettaFile {
  path: string;
  text: string;
}

export type LettaEntryKind = 'wall' | 'drawer' | 'index' | 'skill' | 'empty' | 'starter';
export type LettaDoor = 'new' | 'merge' | 'drawer';
// What the person picked for one memory: onto the wall of the same name, a wall
// of its own, the drawer, or left out.
export type LettaChoice = 'add' | 'wall' | 'drawer' | 'skip';

export interface LettaEntry {
  path: string;
  kind: LettaEntryKind;
  label: string;
  description: string | null;
  body: string;
}

export interface LettaPlanItem extends LettaEntry {
  scope: string | null;
  // The label it lands under, which differs from `label` when it was given a
  // wall of its own beside one that already has the name.
  target: string | null;
  choice: LettaChoice;
  // What the person may pick for this one; empty when there is nothing to bring.
  choices: LettaChoice[];
  // For a wall: 'new' when the wall is empty or missing, 'append' when it
  // already has words. For a drawer: the Cortex domain. Otherwise null.
  action: 'new' | 'append' | 'cortex' | 'skip';
  domain: string | null;
  note: string | null;
}

export interface LettaImportResult {
  companion: string;
  door: LettaDoor;
  dryRun: boolean;
  items: LettaPlanItem[];
  walls: number;
  drawer: number;
  skipped: number;
  errors: { path: string; error: string }[];
}

const MAX_FILES = 500;
const MAX_FILE_CHARS = 200_000;

// A folder export zipped up usually carries the folder's own name (and on a
// Mac a __MACOSX shadow copy) in front of every path; both are noise here.
export function normalizePath(raw: string): string | null {
  let p = raw.replace(/\\/g, '/').replace(/^\.?\//, '').trim();
  if (!p || p.startsWith('__MACOSX/') || /(^|\/)\._/.test(p) || /(^|\/)\.git\//.test(p) || p.startsWith('.git/')) return null;
  if (!p.toLowerCase().endsWith('.md')) return null;
  return p;
}

// Drop a leading folder that every file shares, e.g. "memory/" or the agent id.
export function stripCommonRoot(paths: string[]): (p: string) => string {
  const firstSegs = new Set(paths.map((p) => (p.includes('/') ? p.split('/')[0] : '')));
  if (firstSegs.size !== 1) return (p) => p;
  const [only] = [...firstSegs];
  if (!only || only === 'system' || only === 'skills') return (p) => p;
  return (p) => p.slice(only.length + 1);
}

export function splitFrontmatter(text: string): { meta: Record<string, unknown>; body: string } {
  const src = text.replace(/^﻿/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src);
  if (!m) return { meta: {}, body: src.trim() };
  let meta: Record<string, unknown> = {};
  try {
    const parsed = yaml.load(m[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
  } catch {
    // A header that is not valid YAML is kept as part of the text rather than lost.
    return { meta: {}, body: src.trim() };
  }
  return { meta, body: m[2].trim() };
}

// Labels in this house are plain words joined by underscores; Letta's can be
// paths. Keep the readable part.
// Letta's names for the walls this house already has a name for: an agent's
// root MEMORY.md is what it has learned, which here is continuity.
const OUR_NAMES: Record<string, string> = { memory: 'continuity' };

export function labelFor(relPath: string): string {
  const own = lettaLabel(relPath);
  return OUR_NAMES[own] ?? own;
}

function lettaLabel(relPath: string): string {
  const noExt = relPath.replace(/\.md$/i, '');
  const base = noExt.replace(/^system\//, '');
  return base
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '_')
    .replace(/\//g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'memory';
}

// Letta's own starter memories, recognised by their first line and kept only
// while they are still about the size they were made at (an agent that wrote
// underneath one has made it theirs). Read off Letta Code 0.34.71's presets
// (src/agent/prompts), Nov 27 2026; a later Letta may add more.
const LETTA_STARTERS: { label: string; first: string; max: number }[] = [
  { label: 'human', first: "I haven't gotten to know this person yet.", max: 450 },
  { label: 'human', first: 'Senpai still feels a little twinkly and mysterious to me', max: 600 },
  { label: 'human', first: 'The person on the other side of this terminal is not a workflow box', max: 800 },
  { label: 'human', first: 'Learn sideways, through the work.', max: 1400 },
  { label: 'human', first: 'Name: ?', max: 220 },
  { label: 'persona', first: "I'm a coding assistant, ready to be shaped by how we work together.", max: 120 },
  { label: 'persona', first: 'This is a blank starter personality.', max: 160 },
  { label: 'project', first: "I'm still getting to know this codebase.", max: 640 },
  { label: 'style', first: 'Nothing here yet. If they reveal anything about how they like to code', max: 320 },
];

export function isLettaStarter(label: string, body: string): boolean {
  const text = body.trim();
  const first = text.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('#'))?.trim() ?? '';
  return LETTA_STARTERS.some((s) => s.label === label && first.startsWith(s.first) && text.length <= s.max);
}

// A MEMORY.md is an index when most of its lines point somewhere else (a path,
// a file, a link). One that holds what the agent learned is a memory.
export function readsLikeIndex(body: string): boolean {
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) return true;
  const pointing = lines.filter((l) => /\]\(|\.md\b|\w\/(\s|:|$)|^[-*]\s*[\w.-]+\/\S*/.test(l)).length;
  return pointing * 2 >= lines.length;
}

export function classify(relPath: string, body: string): LettaEntryKind {
  const lower = relPath.toLowerCase();
  const name = lower.split('/').pop() || '';
  if (lower.startsWith('skills/') || name === 'skill.md') return 'skill';
  if (!body.trim()) return 'empty';
  if (name === 'memory.md' && readsLikeIndex(body)) return 'index';
  if (isLettaStarter(labelFor(relPath), body)) return 'starter';
  const depth = lower.split('/').length - 1;
  if (depth === 0) return 'wall';
  if (lower.startsWith('system/') && depth === 1) return 'wall';
  return 'drawer';
}

export function parseLettaFiles(files: LettaFile[]): LettaEntry[] {
  if (files.length > MAX_FILES) throw new Error(`That's ${files.length} files; the import takes at most ${MAX_FILES} at a time.`);
  const kept = files
    .map((f) => ({ path: normalizePath(f.path), text: String(f.text ?? '') }))
    .filter((f): f is { path: string; text: string } => f.path !== null);
  const strip = stripCommonRoot(kept.map((f) => f.path));
  return kept.map((f) => {
    if (f.text.length > MAX_FILE_CHARS) throw new Error(`${f.path} is longer than ${MAX_FILE_CHARS} characters.`);
    const rel = strip(f.path);
    const { meta, body } = splitFrontmatter(f.text);
    const description = typeof meta.description === 'string' ? meta.description.trim() || null : null;
    return { path: rel, kind: classify(rel, body), label: labelFor(rel), description, body };
  });
}

// Which wall a memory lands on. `human` is the person, written once for every
// companion in this house; everything else belongs to the companion it came with.
export function scopeFor(label: string, companion: string): string {
  return label === 'human' ? memoryBlocks.SHARED_SCOPE : companion;
}

export interface LettaPlanOptions {
  door?: LettaDoor;
  // Per memory, by path; anything not named keeps its default.
  choices?: Record<string, LettaChoice>;
  // merge only: whether the human file joins the shared wall about the person.
  humanTo?: 'shared' | 'companion';
}

function choicesFor(kind: LettaEntryKind, door: LettaDoor): LettaChoice[] {
  if (kind !== 'wall' && kind !== 'drawer') return [];
  if (door === 'drawer') return ['drawer', 'skip'];
  return ['add', 'wall', 'drawer', 'skip'];
}

function defaultChoice(kind: LettaEntryKind, door: LettaDoor): LettaChoice {
  if (kind === 'wall') return door === 'drawer' ? 'drawer' : 'add';
  if (kind === 'drawer') return 'drawer';
  return 'skip';
}

// A wall of its own beside one that already has the name: label_letta, then
// label_letta_2 and on, never an existing wall.
function freeLabel(scope: string, label: string, taken: Set<string>): string {
  const base = `${label}_letta`;
  let candidate = base;
  for (let n = 2; memoryBlocks.getBlock(scope, candidate) || taken.has(`${scope}/${candidate}`); n++) candidate = `${base}_${n}`;
  return candidate;
}

const SKIP_NOTES: Partial<Record<LettaEntryKind, string>> = {
  index: 'An index of the folder; nothing to bring over.',
  skill: 'A Letta skill. Skills here are a different shape, so it is left out.',
  starter: "Letta's starter text, not anything learned yet.",
  empty: 'Empty.',
};

export function planLettaImport(entries: LettaEntry[], companion: string, opts: LettaPlanOptions = {}): LettaPlanItem[] {
  const door = opts.door ?? 'merge';
  const humanScope = door === 'merge' && (opts.humanTo ?? 'shared') === 'shared' ? memoryBlocks.SHARED_SCOPE : companion;
  const taken = new Set<string>();
  return entries.map((e) => {
    const choices = choicesFor(e.kind, door);
    const asked = opts.choices?.[e.path];
    const choice = asked && choices.includes(asked) ? asked : defaultChoice(e.kind, door);
    const base = { ...e, choice, choices };
    if (choice === 'skip') {
      return { ...base, scope: null, target: null, action: 'skip' as const, domain: null, note: choices.length ? 'Left out, as picked.' : (SKIP_NOTES[e.kind] ?? null) };
    }
    if (choice === 'drawer') {
      return { ...base, scope: null, target: null, action: 'cortex' as const, domain: companion, note: null };
    }
    const scope = e.label === 'human' ? humanScope : companion;
    let target = e.label;
    if (choice === 'wall' && (memoryBlocks.getBlock(scope, target) || taken.has(`${scope}/${target}`))) target = freeLabel(scope, target, taken);
    taken.add(`${scope}/${target}`);
    const existing = memoryBlocks.getBlock(scope, target);
    const has = Boolean(existing?.content?.trim());
    return {
      ...base, scope, target,
      action: has ? 'append' as const : 'new' as const,
      domain: null,
      note: has ? `${scope}/${target} already has words; the import goes underneath them.` : null,
    };
  });
}

// A new companion's name as this house writes a slug.
export function slugForNewCompanion(name: string): string {
  return trimEdges(String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'), '-').slice(0, 40);
}

// Edge trimming by hand rather than by an anchored regex, which code scanning
// reads as slow on a long run of the trimmed character (alert #100).
function trimEdges(s: string, chars: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

function stamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function importLetta(
  files: LettaFile[],
  companionRaw: string,
  opts: LettaPlanOptions & { dryRun?: boolean; now?: Date; remember?: (content: string, domain: string) => Promise<unknown> } = {},
): Promise<LettaImportResult> {
  const door: LettaDoor = opts.door ?? 'merge';
  let companion: string;
  if (door === 'new') {
    // The route makes the companion after the plan has been looked at, so a
    // look before must find nobody by that name and the real run must find them.
    companion = slugForNewCompanion(companionRaw);
    if (!companion || companion === memoryBlocks.SHARED_SCOPE) throw new Error('Give them a name first.');
    const exists = memoryBlocks.resolveScope(companion) === companion;
    if (opts.dryRun && exists) throw new Error(`There's already someone called ${companion} here. Pick Add to someone here instead, or give them another name.`);
    if (!opts.dryRun && !exists) throw new Error(`${companion} has not been made yet.`);
  } else {
    const found = memoryBlocks.resolveScope(String(companionRaw || ''));
    if (!found || found === memoryBlocks.SHARED_SCOPE) {
      throw new Error(`Pick which companion this memory belongs to. Valid: ${memoryBlocks.validScopesHint()}`);
    }
    companion = found;
  }
  const items = planLettaImport(parseLettaFiles(files), companion, { door, choices: opts.choices, humanTo: opts.humanTo });
  const result: LettaImportResult = { companion, door, dryRun: Boolean(opts.dryRun), items, walls: 0, drawer: 0, skipped: 0, errors: [] };
  const remember = opts.remember ?? ((content: string, domain: string) => rememberThought(content, domain));
  const day = stamp(opts.now ?? new Date());

  for (const item of items) {
    if (item.action === 'skip') { result.skipped++; continue; }
    if (opts.dryRun) {
      if (item.action === 'cortex') result.drawer++; else result.walls++;
      continue;
    }
    try {
      if (item.action === 'new') {
        memoryBlocks.setBlock(item.scope!, item.target!, item.body, item.description ?? undefined);
        result.walls++;
      } else if (item.action === 'append') {
        memoryBlocks.appendToBlock(item.scope!, item.target!, `\nImported from Letta (${item.path}), ${day}:\n${item.body}`);
        result.walls++;
      } else if (item.action === 'cortex') {
        const head = `${item.label.toUpperCase()} (imported from Letta, ${item.path}, ${day})${item.description ? ` — ${item.description}` : ''}`;
        await remember(`${head}\n${item.body}`, item.domain!);
        result.drawer++;
      }
    } catch (err) {
      result.errors.push({ path: item.path, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
