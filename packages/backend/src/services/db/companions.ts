// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Companion management — Full Aerie Mode.
 *
 * Each companion is a distinct AI persona with their own:
 * - Identity (CLAUDE.md path)
 * - Memory (separate cortex MCP config)
 * - Threads (conversation namespace)
 * - Sticker/emoji packs
 * - Model preferences
 *
 * Cohabitation: multiple companions share a thread and all of them are in the
 * room — nothing selects between them. See docs/ARCHITECTURE.md.
 */

import { getDb } from './state.js';
import { existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import crypto from 'crypto';

export interface Companion {
  id: string;
  slug: string;
  display_name: string;
  archetype: string | null;
  claude_md_path: string;
  mcp_json_path: string;
  model: string | null;
  model_autonomous: string | null;
  /** How hard they think. NULL = the house dial. See agent/companion-effort.ts. */
  effort: string | null;
  avatar_url: string | null;
  color: string | null;
  emoji: string | null;
  phone: string | null;
  bio: string | null;
  status: string | null;
  is_primary: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ThreadCompanion {
  thread_id: string;
  companion_id: string;
  role: 'primary' | 'participant' | 'observer';
  can_initiate: number;
  added_at: string;
}

export interface CompanionSession {
  thread_id: string;
  companion_id: string;
  session_id: string | null;
  updated_at: string;
}

// ─── CRUD ─────────────────────────────────────────────────────────

export function createCompanion(params: {
  slug: string;
  displayName: string;
  archetype?: string;
  claudeMdPath: string;
  mcpJsonPath: string;
  model?: string;
  modelAutonomous?: string;
  avatarUrl?: string;
  color?: string;
  emoji?: string;
  isPrimary?: boolean;
}): Companion {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = getDb();

  // If marking as primary, demote all others first
  if (params.isPrimary) {
    db.prepare('UPDATE companions SET is_primary = 0').run();
  }

  const stmt = db.prepare(`
    INSERT INTO companions (
      id, slug, display_name, archetype, claude_md_path, mcp_json_path,
      model, model_autonomous, avatar_url, color, emoji, is_primary, sort_order,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const sortOrder = (db.prepare('SELECT MAX(sort_order) as max FROM companions').get() as any)?.max ?? -1;

  stmt.run(
    id,
    params.slug,
    params.displayName,
    params.archetype ?? null,
    params.claudeMdPath,
    params.mcpJsonPath,
    params.model ?? null,
    params.modelAutonomous ?? null,
    params.avatarUrl ?? null,
    params.color ?? null,
    params.emoji ?? null,
    params.isPrimary ? 1 : 0,
    sortOrder + 1,
    now,
    now,
  );

  return getCompanion(id)!;
}

export function getCompanion(id: string): Companion | null {
  return getDb().prepare('SELECT * FROM companions WHERE id = ?').get(id) as Companion | null;
}

export function getCompanionBySlug(slug: string): Companion | null {
  return getDb().prepare('SELECT * FROM companions WHERE slug = ?').get(slug) as Companion | null;
}

export function getPrimaryCompanion(): Companion | null {
  return getDb().prepare('SELECT * FROM companions WHERE is_primary = 1').get() as Companion | null;
}

export function listCompanions(): Companion[] {
  return getDb().prepare('SELECT * FROM companions ORDER BY sort_order ASC').all() as Companion[];
}

export function updateCompanion(id: string, updates: Partial<{
  slug: string;
  displayName: string;
  display_name: string;
  archetype: string | null;
  claudeMdPath: string;
  mcpJsonPath: string;
  model: string | null;
  modelAutonomous: string | null;
  effort: string | null;
  // Snake case is accepted for the same reason display_name and avatar_url are:
  // the phone reads companions back in the database's own spelling, so a screen
  // that edits what it just read would otherwise send a key nobody binds — and
  // the update would report success while dropping the field.
  model_autonomous: string | null;
  avatarUrl: string | null;
  avatar_url: string | null;
  color: string | null;
  emoji: string | null;
  phone: string | null;
  bio: string | null;
  status: string | null;
  isPrimary: boolean;
  sortOrder: number;
}>): boolean {
  const db = getDb();
  const existing = getCompanion(id);
  if (!existing) return false;

  if (updates.isPrimary) {
    db.prepare('UPDATE companions SET is_primary = 0').run();
  }

  const stmt = db.prepare(`
    UPDATE companions SET
      slug = ?,
      display_name = ?,
      archetype = ?,
      claude_md_path = ?,
      mcp_json_path = ?,
      model = ?,
      model_autonomous = ?,
      effort = ?,
      avatar_url = ?,
      color = ?,
      emoji = ?,
      phone = ?,
      bio = ?,
      status = ?,
      is_primary = ?,
      sort_order = ?,
      updated_at = ?
    WHERE id = ?
  `);

  stmt.run(
    updates.slug ?? existing.slug,
    updates.displayName ?? updates.display_name ?? existing.display_name,
    updates.archetype !== undefined ? updates.archetype : existing.archetype,
    updates.claudeMdPath ?? existing.claude_md_path,
    updates.mcpJsonPath ?? existing.mcp_json_path,
    updates.model !== undefined ? updates.model : existing.model,
    updates.modelAutonomous !== undefined ? updates.modelAutonomous
      : updates.model_autonomous !== undefined ? updates.model_autonomous
      : existing.model_autonomous,
    updates.effort !== undefined ? updates.effort : existing.effort,
    updates.avatarUrl ?? updates.avatar_url ?? existing.avatar_url,
    updates.color !== undefined ? updates.color : existing.color,
    updates.emoji !== undefined ? updates.emoji : existing.emoji,
    updates.phone !== undefined ? updates.phone : existing.phone,
    updates.bio !== undefined ? updates.bio : existing.bio,
    updates.status !== undefined ? updates.status : existing.status,
    updates.isPrimary !== undefined ? (updates.isPrimary ? 1 : 0) : existing.is_primary,
    updates.sortOrder ?? existing.sort_order,
    new Date().toISOString(),
    id,
  );

  return true;
}

export function deleteCompanion(id: string): boolean {
  const db = getDb();
  const companion = getCompanion(id);
  if (!companion) return false;
  if (companion.is_primary) {
    throw new Error('Cannot delete the primary companion');
  }
  db.prepare('DELETE FROM companions WHERE id = ?').run(id);
  return true;
}

// ─── Thread-Companion Assignment ──────────────────────────────────

export function assignCompanionToThread(
  threadId: string,
  companionId: string,
  role: 'primary' | 'participant' | 'observer' = 'participant',
  canInitiate = true,
): void {
  const db = getDb();
  const now = new Date().toISOString();

  // If assigning as primary, demote existing primary in this thread
  if (role === 'primary') {
    db.prepare(
      "UPDATE thread_companions SET role = 'participant' WHERE thread_id = ? AND role = 'primary'"
    ).run(threadId);
  }

  db.prepare(`
    INSERT OR REPLACE INTO thread_companions (thread_id, companion_id, role, can_initiate, added_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(threadId, companionId, role, canInitiate ? 1 : 0, now);
}

export function removeCompanionFromThread(threadId: string, companionId: string): void {
  getDb().prepare('DELETE FROM thread_companions WHERE thread_id = ? AND companion_id = ?')
    .run(threadId, companionId);
}

export function getThreadCompanions(threadId: string): (ThreadCompanion & { companion: Companion })[] {
  return getDb().prepare(`
    SELECT tc.*, c.slug, c.display_name, c.archetype, c.claude_md_path, c.mcp_json_path,
           c.model, c.model_autonomous, c.effort, c.avatar_url, c.color, c.is_primary, c.sort_order,
           c.created_at AS companion_created_at, c.updated_at AS companion_updated_at
    FROM thread_companions tc
    JOIN companions c ON c.id = tc.companion_id
    WHERE tc.thread_id = ?
    ORDER BY CASE tc.role WHEN 'primary' THEN 0 WHEN 'participant' THEN 1 ELSE 2 END, c.sort_order
  `).all(threadId) as any[];
}

export function getDefaultCompanionForThread(threadId: string): Companion | null {
  // First: look for explicit primary in thread_companions
  const primary = getDb().prepare(`
    SELECT c.* FROM companions c
    JOIN thread_companions tc ON tc.companion_id = c.id
    WHERE tc.thread_id = ? AND tc.role = 'primary'
  `).get(threadId) as Companion | null;
  if (primary) return primary;

  // Second: check threads.default_companion_id
  const thread = getDb().prepare('SELECT default_companion_id FROM threads WHERE id = ?').get(threadId) as any;
  if (thread?.default_companion_id) {
    return getCompanion(thread.default_companion_id);
  }

  // Fallback: system primary
  return getPrimaryCompanion();
}

// ─── Companion Sessions (replaces threads.current_session_id) ─────

export function getCompanionSession(threadId: string, companionId: string): string | null {
  const row = getDb().prepare(
    'SELECT session_id FROM companion_sessions WHERE thread_id = ? AND companion_id = ?'
  ).get(threadId, companionId) as { session_id: string | null } | undefined;
  return row?.session_id ?? null;
}

export function setCompanionSession(threadId: string, companionId: string, sessionId: string): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT OR REPLACE INTO companion_sessions (thread_id, companion_id, session_id, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(threadId, companionId, sessionId, now);
}

export function clearCompanionSessions(): void {
  getDb().prepare('DELETE FROM companion_sessions').run();
}

// ─── Seed from filesystem ────────────────────────────────────────

/**
 * Auto-seed companion records from the companions/ directory.
 * Scans for subdirectories containing a CLAUDE.md file.
 * Only creates records that don't already exist (by slug).
 *
 * Called on server startup when aerie mode is enabled.
 */
export function seedCompanionsFromDisk(
  companionsDir: string,
  defaultCompanion?: string,
): { created: string[]; existing: string[] } {
  const created: string[] = [];
  const existing: string[] = [];

  const absDir = resolve(companionsDir);
  if (!existsSync(absDir)) {
    console.log(`[Aerie] Companions directory not found: ${absDir} — skipping seed`);
    return { created, existing };
  }

  const entries = readdirSync(absDir);
  for (const entry of entries) {
    const entryPath = join(absDir, entry);
    if (!statSync(entryPath).isDirectory()) continue;

    const claudeMdPath = join(entryPath, 'CLAUDE.md');
    if (!existsSync(claudeMdPath)) continue;

    const slug = entry.toLowerCase();

    // Check if already registered
    const existingCompanion = getCompanionBySlug(slug);
    if (existingCompanion) {
      existing.push(slug);
      continue;
    }

    // Create new companion record
    const isPrimary = slug === defaultCompanion?.toLowerCase();
    const displayName = entry.charAt(0).toUpperCase() + entry.slice(1);

    // Relative path from project root for portability
    const relativeCiPath = `./companions/${entry}/CLAUDE.md`;
    const relativeMcpPath = `./companions/${entry}/.mcp.json`;

    createCompanion({
      slug,
      displayName,
      claudeMdPath: relativeCiPath,
      mcpJsonPath: relativeMcpPath,
      isPrimary,
    });

    created.push(slug);
    console.log(`[Aerie] Seeded companion: ${displayName} (${slug})${isPrimary ? ' [primary]' : ''}`);
  }

  return { created, existing };
}
