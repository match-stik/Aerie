// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// memory-blocks.ts — Letta-style in-place memory editing
// Companion-scoped labeled blocks the agents can view and modify during conversation.
// scope = a companion slug, or 'shared' (visible to all companions)

import { getDb } from './db.js';
import { getCompanionBySlug, listCompanions } from './db/companions.js';
import { getConfig, setConfig, deleteConfig } from './db/config.js';

export const SHARED_SCOPE = 'shared';

export interface MemoryBlock {
  scope: string;
  label: string;
  content: string;
  description?: string;
  updated_at: string;
}

const TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS memory_blocks (
    scope TEXT NOT NULL DEFAULT 'shared',
    label TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    description TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (scope, label)
  )
`;

// Ensure the table exists, migrating the legacy label-only schema if present.
// The pre-scope table is renamed to memory_blocks_legacy and kept as a backup
// (safe to remove manually once the migration is verified).
export function initMemoryBlocks(): void {
  const db = getDb();
  const hasTable = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_blocks'`)
    .get();

  if (hasTable) {
    const cols = db.prepare(`PRAGMA table_info(memory_blocks)`).all() as { name: string }[];
    if (!cols.some((c) => c.name === 'scope')) {
      db.exec(`
        ALTER TABLE memory_blocks RENAME TO memory_blocks_legacy;
        ${TABLE_DDL};
        INSERT INTO memory_blocks (scope, label, content, description, updated_at)
          SELECT '${SHARED_SCOPE}', label, content, description, updated_at FROM memory_blocks_legacy;
      `);
      return;
    }
  }

  db.exec(TABLE_DDL);
}

// All blocks across every scope (admin / UI)
export function getAllBlocks(): MemoryBlock[] {
  return getDb()
    .prepare('SELECT * FROM memory_blocks ORDER BY scope, label')
    .all() as MemoryBlock[];
}

// Blocks visible to a set of scopes, in the order the scopes are given
export function getBlocksForScopes(scopes: string[]): MemoryBlock[] {
  if (scopes.length === 0) return [];
  const placeholders = scopes.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(`SELECT * FROM memory_blocks WHERE scope IN (${placeholders}) ORDER BY label`)
    .all(...scopes) as MemoryBlock[];
  rows.sort((a, b) => scopes.indexOf(a.scope) - scopes.indexOf(b.scope) || a.label.localeCompare(b.label));
  return rows;
}

export function getBlock(scope: string, label: string): MemoryBlock | null {
  return getDb()
    .prepare('SELECT * FROM memory_blocks WHERE scope = ? AND label = ?')
    .get(scope, label) as MemoryBlock | null;
}

export function setBlock(scope: string, label: string, content: string, description?: string): void {
  getDb()
    .prepare(`
      INSERT INTO memory_blocks (scope, label, content, description, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(scope, label) DO UPDATE SET
        content = excluded.content,
        description = COALESCE(excluded.description, memory_blocks.description),
        updated_at = datetime('now')
    `)
    .run(scope, label, content, description ?? null);
}

export function deleteBlock(scope: string, label: string): void {
  getDb().prepare('DELETE FROM memory_blocks WHERE scope = ? AND label = ?').run(scope, label);
}

// Append a line to a block, creating the block if it doesn't exist
export function appendToBlock(scope: string, label: string, content: string): string {
  const block = getBlock(scope, label);
  const newContent = block && block.content ? block.content + '\n' + content : content;
  setBlock(scope, label, newContent);
  return newContent;
}

// Replace exact text in a block (errors when missing or ambiguous)
export function replaceInBlock(scope: string, label: string, oldText: string, newText: string): string {
  const block = getBlock(scope, label);
  if (!block) throw new Error(`Block '${label}' not found in scope '${scope}'`);

  if (!block.content.includes(oldText)) {
    throw new Error(`Text not found in block '${scope}/${label}'`);
  }

  const escaped = oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const count = (block.content.match(new RegExp(escaped, 'g')) || []).length;
  if (count > 1) {
    throw new Error(`Multiple occurrences (${count}) found. Use more specific text.`);
  }

  const newContent = block.content.replace(oldText, newText);
  setBlock(scope, label, newContent);
  return newContent;
}

// Insert text at a line index (-1 appends)
export function insertInBlock(scope: string, label: string, text: string, line: number = -1): string {
  const block = getBlock(scope, label);
  const lines = block && block.content ? block.content.split('\n') : [];

  if (line === -1 || line >= lines.length) {
    lines.push(text);
  } else {
    lines.splice(line, 0, text);
  }

  const newContent = lines.join('\n');
  setBlock(scope, label, newContent);
  return newContent;
}

// Rethink — complete rewrite of a block
export function rethinkBlock(scope: string, label: string, newContent: string): string {
  setBlock(scope, label, newContent);
  return newContent;
}

// ─── The wall load dial ─────────────
// Every wall has one of three positions. ALWAYS is loaded into every room
// that opens. ROOM is loaded after the always walls, in order, while the
// budget (memory.load_budget_chars) has room; with no budget set it loads like
// always. SEARCH is never loaded: the room is told the wall exists and how
// big it is, and reads it when it needs it. An unset wall is ALWAYS, so a
// house that never touches the dial behaves exactly as it did before.

export type WallLoad = 'always' | 'room' | 'search';
export const WALL_LOADS: readonly WallLoad[] = ['always', 'room', 'search'];
const LOAD_PREFIX = 'memory.load.';
const BUDGET_KEY = 'memory.load_budget_chars';

export function wallLoad(scope: string, label: string): WallLoad {
  const v = getConfig(`${LOAD_PREFIX}${scope}.${label}`);
  return v === 'room' || v === 'search' ? v : 'always';
}

export function setWallLoad(scope: string, label: string, mode: WallLoad): void {
  const key = `${LOAD_PREFIX}${scope}.${label}`;
  if (mode === 'always') deleteConfig(key);
  else setConfig(key, mode);
}

/** The budget for ROOM walls, in characters of wall text. Null means no limit. */
export function loadBudgetChars(): number | null {
  const n = Number(getConfig(BUDGET_KEY));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export function setLoadBudgetChars(chars: number | null): void {
  if (chars == null || !Number.isFinite(chars) || chars <= 0) deleteConfig(BUDGET_KEY);
  else setConfig(BUDGET_KEY, String(Math.floor(chars)));
}

/**
 * Which of these walls a room opens with, and which it is only told about.
 * Pure over its inputs so the rule can be tested without a database.
 */
export function splitByLoad<B extends { scope: string; label: string; content: string }>(
  blocks: B[],
  modeOf: (b: B) => WallLoad,
  budget: number | null,
): { loaded: B[]; skipped: B[] } {
  const always = blocks.filter((b) => modeOf(b) === 'always');
  let used = always.reduce((n, b) => n + b.content.length, 0);
  const roomOk = new Set<B>();
  for (const b of blocks) {
    if (modeOf(b) !== 'room') continue;
    if (budget == null || used + b.content.length <= budget) {
      roomOk.add(b);
      used += b.content.length;
    }
  }
  const loaded = blocks.filter((b) => modeOf(b) === 'always' || roomOk.has(b));
  const skipped = blocks.filter((b) => !loaded.includes(b));
  return { loaded, skipped };
}

/** The walls a room is actually handed, by the dial. */
export function loadedBlocks<B extends { scope: string; label: string; content: string }>(blocks: B[]): B[] {
  return splitByLoad(blocks, (b) => wallLoad(b.scope, b.label), loadBudgetChars()).loaded;
}

// Format blocks for system prompt injection.
// scopes should be ['shared', ...companion slugs active in the thread].
/** A room's own dial, laid over the house's: a mode for a wall, or undefined to follow the house. */
export type WallLoadOverride = (scope: string, label: string) => WallLoad | undefined;

export function formatBlocksForPrompt(scopes: string[], override?: WallLoadOverride): string {
  const all = getBlocksForScopes(scopes);
  if (all.length === 0) return '';
  const { loaded: blocks, skipped } = splitByLoad(all, (b) => override?.(b.scope, b.label) ?? wallLoad(b.scope, b.label), loadBudgetChars());

  let output = '\n<core-memory>\n';
  output +=
    'Persistent memory blocks. Edit them in place with the core_memory_append / core_memory_replace / core_memory_rethink tools when those tools are available. ' +
    'In the Codex CLI lane, use `node tools/core-memory.mjs` when the MCP tools are absent; do not substitute Cortex for a block edit. ' +
    "Blocks scoped 'shared' are visible to every companion; blocks scoped to a companion slug belong to that companion alone. " +
    'Keep them current — when you learn something durable, write it down. ' +
    'A wall holds what you need in hand the moment a session opens: who you are, who your person is, what is true right now and what is still open. ' +
    "How to do one particular job (a recipe, a fix, a house project's working notes) belongs in a skill, and a finished story or old history belongs in Cortex, where search finds it when it fits.\n\n";
  if (skipped.length > 0) {
    // Before the first heading on purpose: the drift parser only reads text
    // under a `## [scope] label` heading, so this line is never mistaken for
    // part of a wall.
    const list = skipped.map((b) => `${b.scope}/${b.label} (${b.content.length.toLocaleString('en-US')} characters)`).join(', ');
    output +=
      `Walls not loaded into this room, by the load dial: ${list}. They are current and yours to read whenever you need them: ` +
      'GET /api/memory/blocks/<scope>/<label> on the public port, or search for what you need. Edit them the same way as the others.\n\n';
  }
  for (const block of blocks) {
    output += `## [${block.scope}] ${block.label}\n`;
    if (block.description) output += `<!-- ${block.description} -->\n`;
    output += (block.content.trim() ? block.content : '(empty)') + '\n\n';
  }
  output += '</core-memory>\n';
  return output;
}

// What each starting wall is for, in one line. The description rides into the
// prompt right above its wall, so it is the first thing a companion reads
// about it, and it also says what does NOT belong there: a status wall nobody
// told otherwise slowly turns into the house's manual.
function humanDescription(userName: string): string {
  return `Who ${userName.trim() || 'your person'} is: their people, their history, their preferences and what not to step on. Every companion reads it.`;
}
const STATUS_DESCRIPTION =
  'What is true in the house right now, and what is still open, a line each; a line comes down when its thing is done. How to do a job goes in a skill, not here.';
function personaDescription(name: string): string {
  return `${name}'s own wall, written by ${name}: who they are and what they have learned about themselves.`;
}

// The notes the first versions seeded. A house still carrying one of these
// exactly gets the newer note; a note anybody has changed is left alone.
function refreshSeededDescriptions(userName: string, companions: { slug: string; display_name: string }[]): void {
  const update = getDb().prepare(
    'UPDATE memory_blocks SET description = ? WHERE scope = ? AND label = ? AND description = ?',
  );
  update.run(humanDescription(userName), SHARED_SCOPE, 'human', 'Information about the user, shared across companions');
  update.run(STATUS_DESCRIPTION, SHARED_SCOPE, 'status', 'Current status, ongoing projects, open questions');
  for (const c of companions) {
    update.run(personaDescription(c.display_name), c.slug, 'persona', `${c.display_name}'s self-authored persona and continuity`);
  }
}

// Seed default blocks for a brand-new installation
export function seedDefaultBlocks(
  userName: string,
  companions: { slug: string; display_name: string }[]
): void {
  refreshSeededDescriptions(userName, companions);
  const existing = getAllBlocks();
  if (existing.length > 0) return;

  setBlock(SHARED_SCOPE, 'human', `Name: ${userName}`, humanDescription(userName));
  setBlock(SHARED_SCOPE, 'status', '', STATUS_DESCRIPTION);
  for (const c of companions) {
    setBlock(c.slug, 'persona', `I am ${c.display_name}.`, personaDescription(c.display_name));
  }
}

// Non-destructive: make sure every companion has its own persona block
export function ensureCompanionBlocks(companions: { slug: string; display_name: string }[]): void {
  for (const c of companions) {
    if (!getBlock(c.slug, 'persona')) {
      setBlock(c.slug, 'persona', `I am ${c.display_name}.`, personaDescription(c.display_name));
    }
  }
}

// Validate a scope string: 'shared' or an existing companion slug.
// Returns the normalized scope, or null if unknown.
export function resolveScope(scope: string): string | null {
  const s = scope.trim().toLowerCase();
  if (s === SHARED_SCOPE) return SHARED_SCOPE;
  return getCompanionBySlug(s) ? s : null;
}

export function validScopesHint(): string {
  const slugs = listCompanions().map((c) => `'${c.slug}'`).join(', ');
  return `'${SHARED_SCOPE}'${slugs ? ', ' + slugs : ''}`;
}
