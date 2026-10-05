// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// memory-blocks.ts — Letta-style in-place memory editing
// Companion-scoped labeled blocks the agents can view and modify during conversation.
// scope = a companion slug, or 'shared' (visible to all companions)

import { getDb } from './db.js';
import { getCompanionBySlug, listCompanions } from './db/companions.js';

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

// Format blocks for system prompt injection.
// scopes should be ['shared', ...companion slugs active in the thread].
export function formatBlocksForPrompt(scopes: string[]): string {
  const blocks = getBlocksForScopes(scopes);
  if (blocks.length === 0) return '';

  let output = '\n<core-memory>\n';
  output +=
    'Persistent memory blocks. Edit them in place with the core_memory_append / core_memory_replace / core_memory_rethink tools when those tools are available. ' +
    'In the Codex CLI lane, use `node tools/core-memory.mjs` when the MCP tools are absent; do not substitute Cortex for a block edit. ' +
    "Blocks scoped 'shared' are visible to every companion; blocks scoped to a companion slug belong to that companion alone. " +
    'Keep them current — when you learn something durable, write it down.\n\n';
  for (const block of blocks) {
    output += `## [${block.scope}] ${block.label}\n`;
    if (block.description) output += `<!-- ${block.description} -->\n`;
    output += (block.content.trim() ? block.content : '(empty)') + '\n\n';
  }
  output += '</core-memory>\n';
  return output;
}

// Seed default blocks for a brand-new installation
export function seedDefaultBlocks(
  userName: string,
  companions: { slug: string; display_name: string }[]
): void {
  const existing = getAllBlocks();
  if (existing.length > 0) return;

  setBlock(SHARED_SCOPE, 'human', `Name: ${userName}`, 'Information about the user, shared across companions');
  setBlock(SHARED_SCOPE, 'status', '', 'Current status, ongoing projects, open questions');
  for (const c of companions) {
    setBlock(c.slug, 'persona', `I am ${c.display_name}.`, `${c.display_name}'s self-authored persona and continuity`);
  }
}

// Non-destructive: make sure every companion has its own persona block
export function ensureCompanionBlocks(companions: { slug: string; display_name: string }[]): void {
  for (const c of companions) {
    if (!getBlock(c.slug, 'persona')) {
      setBlock(c.slug, 'persona', `I am ${c.display_name}.`, `${c.display_name}'s self-authored persona and continuity`);
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
