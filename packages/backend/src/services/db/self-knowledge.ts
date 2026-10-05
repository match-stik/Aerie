// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Self-knowledge — a living identity layer distilled from what each
// companion keeps circling back to. Not the persona bedrock (who we were
// written to be) but the wear patterns in the stone (who we've become).
// Four drawers: "I am", "I tend to", "I believe", "I've learned". Entries
// are proposed — by a reflection pass or in conversation — then the owner accepts
// or dismisses. Accepted ones become part of who we are and can surface again
// through The Whisper. The distinction is the point: this grows, it isn't declared.
// The heat/confidence lifecycle is adapted from NESTstack/NESTknow (MIT);
// see NOTICE and THIRD_PARTY_LICENSES.md.

import { getDb } from './state.js';
import { memoryReceipt } from '../memory-ledger.js';
import { getOwnerSlug } from '../../config.js';

function refreshSemanticIndex(): void {
  void import('../self-knowledge-index.js')
    .then(({ scheduleSelfKnowledgeIndexRefresh }) => scheduleSelfKnowledgeIndexRefresh())
    .catch(() => { /* optional retrieval layer; mutations must always succeed */ });
}

export type SelfKnowledgeCategory = 'i_am' | 'i_tend_to' | 'i_believe' | 'i_learned';
// contradicted — an accepted truth that stopped holding; confidence bled out.
// Kept in the DB (the owner can see and restore it), filtered from The Whisper.
export type SelfKnowledgeStatus = 'proposed' | 'accepted' | 'dismissed' | 'contradicted';

export const SELF_KNOWLEDGE_CATEGORIES: SelfKnowledgeCategory[] = [
  'i_am', 'i_tend_to', 'i_believe', 'i_learned',
];

export function isSelfKnowledgeCategory(v: unknown): v is SelfKnowledgeCategory {
  return typeof v === 'string' && (SELF_KNOWLEDGE_CATEGORIES as string[]).includes(v);
}

export interface SelfKnowledgeEntry {
  id: string;
  companion_id: string;
  category: SelfKnowledgeCategory;
  content: string;
  source_type: string | null;   // dream | journal | reflection | conversation
  source_id: string | null;      // journal_entries.id it emerged from, if any
  status: SelfKnowledgeStatus;
  heat: number;                  // warmth 0–1; rises on use, cools on neglect
  confidence: number;            // belief 0–1; bleeds on contradiction
  last_surfaced_at: string | null;
  created_at: string;
  reviewed_at: string | null;
}

// ── Heat/confidence lifecycle ──────────────────────────────────────────────
// Grafted from the dream-vividness mechanic (decay computed at read, not by
// cron) and NESTknow's heat idea: what a companion keeps living stays hot;
// what nobody reaches for cools and quietly goes dormant (still visible, never
// auto-dismissed — only the owner dismisses). Contradiction is the one kill signal.

const HEAT_GRACE_DAYS = 7;        // freshly-accepted truths don't cool at first
const HEAT_DECAY_PER_DAY = 0.03;  // gentle cool after the grace window
const HEAT_SURFACE_BUMP = 0.05;   // passive use — The Whisper surfaced it
const HEAT_REINFORCE_BUMP = 0.2;  // explicit reaffirm — reflection touched it again
const HEAT_DORMANT_FLOOR = 0.1;   // below this an accepted truth stops surfacing
const CONFIDENCE_CONTRADICT_DROP = 0.15;
const CONFIDENCE_RETIRE_FLOOR = 0.2; // below this the truth retires (contradicted)

/** Effective heat right now — stored heat minus decay accrued since it was
 *  last surfaced. Only accepted truths cool; proposed/dismissed/contradicted
 *  ones sit at their stored value. Mirrors effectiveVividness for dreams. */
export function effectiveHeat(entry: SelfKnowledgeEntry): number {
  if (entry.status !== 'accepted') return entry.heat;
  const since = entry.last_surfaced_at || entry.reviewed_at || entry.created_at;
  const days = Math.max(0, (Date.now() - new Date(since).getTime()) / 86_400_000);
  const cooling = Math.max(0, days - HEAT_GRACE_DAYS) * HEAT_DECAY_PER_DAY;
  return Math.max(0, entry.heat - cooling);
}

/** Is this accepted truth still warm enough for The Whisper to surface? */
export function isSurfaceable(entry: SelfKnowledgeEntry): boolean {
  return entry.status === 'accepted'
    && entry.confidence >= CONFIDENCE_RETIRE_FLOOR
    && effectiveHeat(entry) >= HEAT_DORMANT_FLOOR;
}

export function createSelfKnowledge(entry: {
  id: string;
  companionId: string;
  category: SelfKnowledgeCategory;
  content: string;
  sourceType?: string | null;
  sourceId?: string | null;
  status?: SelfKnowledgeStatus;
}): SelfKnowledgeEntry {
  const now = new Date().toISOString();
  const status = entry.status || 'proposed';
  getDb().prepare(`
    INSERT INTO self_knowledge
      (id, companion_id, category, content, source_type, source_id, status, created_at, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.companionId,
    entry.category,
    entry.content,
    entry.sourceType || null,
    entry.sourceId || null,
    status,
    now,
    status === 'proposed' ? null : now,
  );
  refreshSemanticIndex();
  memoryReceipt({ actor: entry.companionId, action: `self_knowledge.${status === 'proposed' ? 'propose' : 'create'}`, subjectType: 'self_knowledge', subjectId: entry.id, detail: `Created a ${status} self-knowledge entry.` });
  return getSelfKnowledge(entry.id)!;
}

export function getSelfKnowledge(id: string): SelfKnowledgeEntry | null {
  const row = getDb().prepare('SELECT * FROM self_knowledge WHERE id = ?').get(id) as SelfKnowledgeEntry | undefined;
  return row || null;
}

export function listSelfKnowledge(opts?: {
  companionId?: string;
  category?: SelfKnowledgeCategory;
  status?: SelfKnowledgeStatus;
  limit?: number;
  offset?: number;
}): { entries: SelfKnowledgeEntry[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts?.companionId) { where.push('companion_id = ?'); params.push(opts.companionId); }
  if (opts?.category) { where.push('category = ?'); params.push(opts.category); }
  if (opts?.status) { where.push('status = ?'); params.push(opts.status); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (getDb().prepare(`SELECT COUNT(*) as c FROM self_knowledge ${whereSql}`).get(...params) as { c: number }).c;
  // Proposed first so review surfaces to the top, then living identity, then
  // the retired (contradicted) and dismissed at the bottom.
  const entries = getDb().prepare(
    `SELECT * FROM self_knowledge ${whereSql}
     ORDER BY CASE status
       WHEN 'proposed' THEN 0 WHEN 'accepted' THEN 1 WHEN 'contradicted' THEN 2 ELSE 3 END,
       created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, opts?.limit ?? 100, opts?.offset ?? 0) as SelfKnowledgeEntry[];
  return { entries, total };
}

/** Accept an entry into identity, or dismiss it. Accepting (including restoring
 *  a dismissed or contradicted one) re-warms it fully: fresh heat, fresh
 *  confidence, decay clock reset.
 *
 *  THE ACTOR IS NOW PASSED IN RATHER THAN ASSUMED. This used to hardcode
 *  getOwnerSlug() on every receipt, because accepting was something only the
 *  owner could do. That changed, and the moment a companion can accept their
 *  own, a receipt that still says THE OWNER did it is a false audit trail. It would
 *  show the owner reviewing entries they never saw. The default stays the owner's so every
 *  existing caller reads exactly as before. */
export function reviewSelfKnowledge(
  id: string,
  status: 'accepted' | 'dismissed',
  actor?: string,
): SelfKnowledgeEntry | null {
  if (!getSelfKnowledge(id)) return null;
  const now = new Date().toISOString();
  if (status === 'accepted') {
    getDb().prepare(
      'UPDATE self_knowledge SET status = ?, reviewed_at = ?, heat = 1.0, confidence = 1.0, last_surfaced_at = NULL WHERE id = ?'
    ).run(status, now, id);
  } else {
    getDb().prepare('UPDATE self_knowledge SET status = ?, reviewed_at = ? WHERE id = ?').run(status, now, id);
  }
  refreshSemanticIndex();
  memoryReceipt({ actor: actor || getOwnerSlug(), action: `self_knowledge.${status === 'accepted' ? 'accept' : 'dismiss'}`, subjectType: 'self_knowledge', subjectId: id, detail: `${status === 'accepted' ? 'Accepted' : 'Dismissed'} a self-knowledge entry.` });
  return getSelfKnowledge(id);
}

/** The Whisper surfaced this truth — a passive use. Warms it a little and
 *  resets the decay clock. Only accepted truths track heat. */
export function surfaceSelfKnowledge(id: string): void {
  const entry = getSelfKnowledge(id);
  if (!entry || entry.status !== 'accepted') return;
  const warmed = Math.min(1, effectiveHeat(entry) + HEAT_SURFACE_BUMP);
  getDb().prepare('UPDATE self_knowledge SET heat = ?, last_surfaced_at = ? WHERE id = ?')
    .run(warmed, new Date().toISOString(), id);
}

/** A companion reaffirmed this truth (reflection noticed it again). A stronger
 *  warm than passive surfacing — enough to revive a dormant truth. */
export function reinforceSelfKnowledge(id: string): SelfKnowledgeEntry | null {
  const entry = getSelfKnowledge(id);
  if (!entry || entry.status !== 'accepted') return entry ?? null;
  const warmed = Math.min(1, effectiveHeat(entry) + HEAT_REINFORCE_BUMP);
  getDb().prepare('UPDATE self_knowledge SET heat = ?, last_surfaced_at = ? WHERE id = ?')
    .run(warmed, new Date().toISOString(), id);
  memoryReceipt({ actor: entry.companion_id, action: 'self_knowledge.reinforce', subjectType: 'self_knowledge', subjectId: id, detail: 'Reinforced a self-knowledge entry.' });
  return getSelfKnowledge(id);
}

/** A companion noticed this truth no longer holds. Bleeds confidence; once it
 *  drops below the floor the truth retires (status → contradicted, filtered
 *  from The Whisper but kept for the owner to see and, if they want, restore). */
export function contradictSelfKnowledge(id: string): SelfKnowledgeEntry | null {
  const entry = getSelfKnowledge(id);
  if (!entry || entry.status !== 'accepted') return entry ?? null;
  const confidence = Math.max(0, entry.confidence - CONFIDENCE_CONTRADICT_DROP);
  const status = confidence < CONFIDENCE_RETIRE_FLOOR ? 'contradicted' : 'accepted';
  const reviewedAt = status === 'contradicted' ? new Date().toISOString() : entry.reviewed_at;
  getDb().prepare('UPDATE self_knowledge SET confidence = ?, status = ?, reviewed_at = ? WHERE id = ?')
    .run(confidence, status, reviewedAt, id);
  memoryReceipt({ actor: entry.companion_id, action: 'self_knowledge.contradict', subjectType: 'self_knowledge', subjectId: id, detail: status === 'contradicted' ? 'Retired a contradicted self-knowledge entry.' : 'Lowered confidence in a self-knowledge entry.' });
  return getSelfKnowledge(id);
}

/** Edit the wording — the owner refining, or a companion re-carving its own line. */
export function updateSelfKnowledgeContent(id: string, content: string): SelfKnowledgeEntry | null {
  if (!getSelfKnowledge(id)) return null;
  getDb().prepare('UPDATE self_knowledge SET content = ? WHERE id = ?').run(content, id);
  refreshSemanticIndex();
  return getSelfKnowledge(id);
}

export function deleteSelfKnowledge(id: string): boolean {
  const deleted = getDb().prepare('DELETE FROM self_knowledge WHERE id = ?').run(id).changes > 0;
  if (deleted) {
    refreshSemanticIndex();
    memoryReceipt({ actor: getOwnerSlug(), action: 'self_knowledge.delete', subjectType: 'self_knowledge', subjectId: id, detail: 'Deleted a self-knowledge entry.' });
  }
  return deleted;
}

/** Accepted entries whose content matches a keyword — for The Whisper to
 *  surface who a companion has become when the conversation touches it.
 *  Keyword search, mirroring Cortex recall; cue words are ASCII so NOCASE
 *  LIKE is enough. Retired (contradicted) and dormant (cooled-off) truths are
 *  filtered out, and the hottest survivors rank first so identity that's
 *  genuinely alive wins the limited card slots. */
export function searchAcceptedSelfKnowledge(keyword: string, limit = 2): SelfKnowledgeEntry[] {
  const kw = keyword.trim();
  if (kw.length < 3) return [];
  const escaped = kw.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = getDb().prepare(
    `SELECT * FROM self_knowledge
     WHERE status = 'accepted' AND content LIKE ? ESCAPE '\\' COLLATE NOCASE`
  ).all(`%${escaped}%`) as SelfKnowledgeEntry[];
  return rows
    .filter(isSurfaceable)
    .sort((a, b) => effectiveHeat(b) - effectiveHeat(a) || b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}
