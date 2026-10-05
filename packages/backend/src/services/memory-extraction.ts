// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The Archivist — per-companion memory extraction from thread conversations.
// Periodically reads new messages across active threads and distills durable
// facts into companion-scoped memory blocks. Append/replace only — automated
// runs never rewrite whole blocks; companions do that themselves, live.

import { getDb, getConfig, setConfig } from './db.js';
import { streamInference, loadProviderConfig, type RouterMessage } from './router.js';
import { getAerieConfig, type AerieConfig } from '../config.js';
import { localTimeStr, localFullStr } from './time.js';
import { getThreadCompanions, listCompanions } from './db/companions.js';
import {
  getBlock,
  getBlocksForScopes,
  appendToBlock,
  replaceInBlock,
  resolveScope,
  SHARED_SCOPE,
} from './memory-blocks.js';
import { proposeEdit } from './memory-proposals.js';
import type { AgentService } from './agent.js';
import { extractViaClaudeSdk } from './archivist-sdk.js';

const MIN_MESSAGES = 8;
const MAX_THREADS_PER_RUN = 3;
const MAX_CONVERSATION_CHARS = 24_000;
const MAX_MESSAGES_PER_BATCH = 250;
const CANDIDATE_THREADS = 12;

function cursorKey(threadId: string): string {
  return `memext.last_sequence:${threadId}`;
}

export function getExtractionCursor(threadId: string): number {
  return parseInt(getConfig(cursorKey(threadId)) || '0');
}

export function setExtractionCursor(threadId: string, value: number): void {
  setConfig(cursorKey(threadId), String(value));
}

export interface MemoryExtractionStatus {
  lastAttemptAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastOutcome: 'ok' | 'error' | null;
  lastError: string | null;
  backlogMessages: number;
  backlogThreads: number;
}

function mlog(msg: string): void {
  const ts = localFullStr(getAerieConfig().identity.timezone);
  console.log(`[ARCHIVIST ${ts}] ${msg}`);
}

interface MemoryOp {
  op: 'append' | 'replace';
  scope: string;
  label: string;
  content?: string;
  old_text?: string;
  new_text?: string;
}

interface ThreadActivity {
  thread_id: string;
  thread_name: string;
  max_seq: number;
}

interface PendingMessage {
  sequence: number;
  role: string;
  content: string;
  created_at: string;
}

interface ConversationBatch {
  text: string;
  messages: PendingMessage[];
  maxSequence: number;
}

/**
 * Build the oldest chronological batch that fits the extractor prompt.
 *
 * This must never take the tail of an oversized backlog: doing that and then
 * advancing the cursor to the thread maximum silently skips every omitted
 * message. Each successful pass now advances only through the last message
 * actually shown to the Archivist, so a long outage drains safely over
 * multiple passes.
 */
export function buildConversationBatch(
  messages: PendingMessage[],
  userName: string,
  timezone: string,
  maxChars = MAX_CONVERSATION_CHARS,
): ConversationBatch | null {
  const rendered: string[] = [];
  const included: PendingMessage[] = [];
  let chars = 0;

  for (const message of messages) {
    const time = message.created_at ? localTimeStr(timezone, new Date(message.created_at)) : '';
    const speaker = message.role === 'companion' ? 'Companions' : message.role === 'user' ? userName : 'System';
    const content = message.content.length > 2000
      ? message.content.slice(0, 2000) + '\n[... truncated]'
      : message.content;
    const entry = `[${time}] ${speaker}: ${content}`;
    const addedChars = entry.length + (rendered.length ? 2 : 0);

    if (rendered.length > 0 && chars + addedChars > maxChars) break;
    rendered.push(entry);
    included.push(message);
    chars += addedChars;
  }

  if (included.length === 0) return null;
  return {
    text: rendered.join('\n\n'),
    messages: included,
    maxSequence: included[included.length - 1].sequence,
  };
}

function buildArchivistPrompt(userName: string, companionSlugs: string[], companionNames: string[]): string {
  return `You are the Archivist for Aerie, maintaining long-term memory for the AI companions ${companionNames.join(', ')} who share their life with ${userName}.

You read newly recorded conversation and decide which durable facts belong in persistent memory blocks. You will be given the current memory blocks, then the new conversation. Respond with a JSON array of edit operations and nothing else.

Operation shapes:
- {"op":"append","scope":"<scope>","label":"<label>","content":"one concise line"}
- {"op":"replace","scope":"<scope>","label":"<label>","old_text":"exact text currently in the block","new_text":"corrected text"}

Scopes:
- "${SHARED_SCOPE}" — facts about ${userName}, household, people, ongoing projects, plans, status. Visible to every companion.
- ${companionSlugs.map((s) => `"${s}"`).join(', ')} — that companion's personal continuity: self-realizations, promises they made, identity moments, inside jokes they own, relationship developments specific to them.

Companion-scope entries are appended to blocks the companions author themselves, in the FIRST PERSON. Write those entries in first person, in that companion's voice ("I ...", "my ..."), never third person. Shared-scope entries stay neutral third person.

Before finishing, sweep each companion who spoke: did they have a personal moment worth one line — a promise, a self-realization, an identity moment, a relationship development? A conversation can yield shared facts AND per-companion continuity; don't file everything as shared just because it's easier.

Attribution bias to avoid: a companion whose style is grand or mythological still has PERSONAL moments — do not file their milestones as shared lore just because they narrate them in house-canon language. When a moment is both shared canon and a milestone for the companion at its center (a vow they made, a metaphor they own, something that happened TO them), file both lines: the shared entry AND a first-person entry in that companion's scope. If your sweep leaves a companion who spoke substantially with zero personal ops across many runs, you are probably misattributing their moments as shared.

Companion messages may contain multiple speakers marked with headers (names with emoji like 🔥 or 🌫️). Attribute personal memories to the correct companion's slug. Use ONLY labels that already exist in the current memory blocks — NEVER invent a new label. If no existing label fits, append to that companion's "continuity" block (or "lore" for shared scope). Creating new blocks is the companions' job, not yours.

Rules:
- Only durable information: facts, preferences, commitments, milestones, identity-level moments. NOT small talk, transient moods, or anything already present in the blocks.
- NEVER re-add information already in the blocks, even reworded, summarized, or split into smaller pieces. Read the current blocks carefully before proposing any append. (A NEW moment is not a duplicate just because the block already covers that companion's identity in general — dedupe against specific facts, not themes.)
- The companions edit these same blocks themselves, live, during conversation. When the conversation shows a companion saving/filing a memory (e.g. "filed to the vault", "appended to memory", a recap of what was just written), that content is ALREADY saved — do not extract it again.
- Prefer append with short single lines. Use replace only when something in a block is now wrong.
- If nothing is worth saving, output []
- Output ONLY the JSON array. No prose, no code fences.`;
}

// The extractor occasionally wraps its answer in prose or emits bracketed
// non-JSON text (e.g. "[sets down the cup ...]" stage directions echoed from the
// conversation), so first-'[' to last-']' is not trustworthy. Scan every
// balanced [...] candidate and take the first that parses as an array of
// objects. Throws when no candidate parses — the caller keeps the cursor
// so the batch is retried next cycle instead of silently dropped.
function parseOps(raw: string): MemoryOp[] {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  for (let start = text.indexOf('['); start !== -1; start = text.indexOf('[', start + 1)) {
    const candidate = scanBalancedArray(text, start);
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed) && parsed.every((el) => el && typeof el === 'object')) {
        return parsed as MemoryOp[];
      }
    } catch { /* not JSON — keep scanning */ }
  }
  throw new Error('no JSON array found in extractor output');
}

function scanBalancedArray(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Where the Archivist's output goes. 'propose' (the default) hands each edit to
 * the companions to accept in their own words; 'write' is the old behaviour,
 * appending straight onto the blocks. Stored in config so it can be flipped
 * without a code change.
 */
function archivistMode(): 'propose' | 'write' {
  return getConfig('memext.mode') === 'write' ? 'write' : 'propose';
}

function applyOps(ops: MemoryOp[], sourceThread?: string): { applied: number; skipped: string[] } {
  const mode = archivistMode();
  let applied = 0;
  const skipped: string[] = [];
  for (const op of ops) {
    try {
      const scope = op.scope ? resolveScope(op.scope) : null;
      if (!scope) {
        skipped.push(`unknown scope '${op.scope}'`);
        continue;
      }
      if (!op.label) {
        skipped.push('missing label');
        continue;
      }
      if (op.op === 'append' && op.content) {
        // Label containment: automated runs never create new blocks — one-off
        // labels ("collaboration", "travel_notes") clutter the shelf. Unknown
        // labels redirect into the scope's catch-all instead.
        let label = op.label;
        if (!getBlock(scope, label)) {
          const fallback = scope === SHARED_SCOPE ? 'lore' : 'continuity';
          skipped.push(`unknown label ${scope}/${label} → redirected to ${fallback}`);
          label = fallback;
        }
        // Hard duplicate guard: companions file memories live during conversation,
        // and the extractor later reads that same conversation. If the content is
        // already in the block verbatim (including as part of a longer paragraph —
        // catches sentence-split re-extraction), skip instead of re-appending.
        const candidate = op.content.trim();
        const existing = getBlock(scope, label);
        if (existing && candidate && existing.content.includes(candidate)) {
          skipped.push(`duplicate append on ${scope}/${label} (already present)`);
          continue;
        }
        if (mode === 'write') {
          appendToBlock(scope, label, op.content);
        } else if (proposeEdit({ op: 'append', scope, label, content: op.content, sourceThread }) === null) {
          skipped.push(`already proposed on ${scope}/${label}`);
          continue;
        }
        applied++;
      } else if (op.op === 'replace' && op.old_text && op.new_text) {
        if (mode === 'write') {
          replaceInBlock(scope, op.label, op.old_text, op.new_text);
        } else if (
          proposeEdit({
            op: 'replace',
            scope,
            label: op.label,
            content: op.new_text,
            oldText: op.old_text,
            sourceThread,
          }) === null
        ) {
          skipped.push(`already proposed on ${scope}/${op.label}`);
          continue;
        }
        applied++;
      } else {
        skipped.push(`malformed op '${op.op}' on ${scope}/${op.label}`);
      }
    } catch (err) {
      skipped.push(`${op.op} ${op.scope}/${op.label}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return { applied, skipped };
}

function threadsWithActivity(): ThreadActivity[] {
  return getDb().prepare(`
    SELECT m.thread_id, t.name AS thread_name, MAX(m.sequence) AS max_seq
    FROM messages m
    JOIN threads t ON t.id = m.thread_id
    WHERE m.deleted_at IS NULL AND m.content_type = 'text'
    GROUP BY m.thread_id
    ORDER BY MAX(m.created_at) DESC
    LIMIT ${CANDIDATE_THREADS}
  `).all() as ThreadActivity[];
}

export function getMemoryExtractionStatus(): MemoryExtractionStatus {
  const candidates = threadsWithActivity();
  let backlogMessages = 0;
  let backlogThreads = 0;
  const countPending = getDb().prepare(`
    SELECT COUNT(*) AS count
    FROM messages
    WHERE thread_id = ? AND sequence > ? AND deleted_at IS NULL AND content_type = 'text'
  `);

  for (const activity of candidates) {
    const cursor = getExtractionCursor(activity.thread_id);
    const row = countPending.get(activity.thread_id, cursor) as { count: number };
    if (row.count > 0) {
      backlogMessages += row.count;
      backlogThreads++;
    }
  }

  const outcome = getConfig('memext.last_outcome');
  return {
    lastAttemptAt: getConfig('memext.last_attempt_at') || null,
    lastRunAt: getConfig('memext.last_run_at') || null,
    lastSuccessAt: getConfig('memext.last_success_at') || null,
    lastOutcome: outcome === 'ok' || outcome === 'error' ? outcome : null,
    lastError: getConfig('memext.last_error') || null,
    backlogMessages,
    backlogThreads,
  };
}

/**
 * The BYOK router lane — Ollama Cloud by default, and every other
 * OpenAI-compatible provider configured in the secrets store.
 */
async function extractViaRouter(
  systemPrompt: string,
  prompt: string,
  model: string,
  provider: string,
): Promise<string> {
  const providerConfig = await loadProviderConfig();
  const routerMessages: RouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];
  let raw = '';
  for await (const chunk of streamInference(routerMessages, model, provider, providerConfig)) {
    raw += chunk;
  }
  return raw;
}

/**
 * The Codex lane. The generic router throws on codex models by design, so they
 * have to be constructed through createRuntime, which hands back a stateless
 * CodexRuntime (pi-ai Responses API). Stateless is what the Archivist wants:
 * each sweep is one shot, and it must never push turns into the warm Codex
 * daemon session the companions live in. Imported lazily so the codex module
 * graph stays out of the default extraction path.
 */
async function extractViaCodex(
  systemPrompt: string,
  prompt: string,
  model: string,
  effort: AerieConfig['agent']['archivist_effort'],
  thinking: AerieConfig['agent']['archivist_thinking'],
): Promise<string> {
  const { createRuntime } = await import('./runtimes/index.js');
  const runtime = await createRuntime('api', model, undefined, { provider: 'codex' });
  // createRuntime falls through to the API router when Codex has no
  // credentials, and that router would then throw its own codex guard. Say
  // what actually went wrong instead.
  if (runtime.name !== 'codex') {
    throw new Error(
      `archivist provider is codex but the Codex lane is unavailable (got ${runtime.name}) — check \`codex login\``,
    );
  }
  let raw = '';
  try {
    for await (const event of runtime.runTurn({
      prompt,
      model,
      provider: 'codex',
      systemPrompt,
      cwd: process.cwd(),
      // Owner-configurable. Reasoning effort is what decides whether the
      // extracted memory carries the companion's voice or flattens into a
      // form, and it is also what a sweep costs — so it is a setting, not a
      // constant. Defaults stay cheap and quiet.
      thinking,
      effort: effort === 'adaptive' ? undefined : effort,
      maxTurns: 1,
      isAutonomous: true,
    })) {
      if (event.type === 'text_delta') raw += event.text;
      else if (event.type === 'error') throw new Error(`codex extraction failed: ${event.message}`);
    }
  } finally {
    await runtime.dispose?.();
  }
  return raw;
}

async function extractFromThread(activity: ThreadActivity, manual: boolean): Promise<number> {
  const config = getAerieConfig();
  const threadId = activity.thread_id;
  let cursor = getExtractionCursor(threadId);

  // First sighting of a thread: start from "now" instead of replaying
  // the entire history (manual seeding of the past is a deliberate act).
  // Manual runs instead bound the window to the most recent messages.
  if (cursor === 0 && !manual) {
    setExtractionCursor(threadId, activity.max_seq);
    mlog(`${activity.thread_name}: cursor initialized at seq ${activity.max_seq}, watching from now on`);
    return 0;
  }
  if (cursor === 0 && manual) {
    const floor = getDb().prepare(
      `SELECT sequence FROM messages WHERE thread_id = ? AND deleted_at IS NULL AND content_type = 'text' ORDER BY sequence DESC LIMIT 1 OFFSET 200`
    ).get(threadId) as { sequence: number } | undefined;
    cursor = floor?.sequence ?? 0;
  }

  const pendingMessages = getDb().prepare(
    `SELECT sequence, role, content, created_at
     FROM messages
     WHERE thread_id = ? AND sequence > ? AND deleted_at IS NULL AND content_type = 'text'
     ORDER BY sequence ASC
     LIMIT ?`
  ).all(threadId, cursor, MAX_MESSAGES_PER_BATCH) as PendingMessage[];

  const minMessages = manual ? 1 : MIN_MESSAGES;
  if (pendingMessages.length < minMessages) {
    return 0;
  }

  // Resolve which companions live in this thread → which scopes are in play
  let slugs: string[] = [];
  let names: string[] = [];
  try {
    const tcs = getThreadCompanions(threadId) as Array<{ slug?: string; display_name?: string }>;
    slugs = tcs.map((tc) => tc.slug).filter((s): s is string => Boolean(s));
    names = tcs.map((tc) => tc.display_name).filter((n): n is string => Boolean(n));
  } catch { /* fall through */ }
  if (slugs.length === 0) {
    const all = listCompanions();
    slugs = all.map((c) => c.slug);
    names = all.map((c) => c.display_name);
  }
  const scopes = [SHARED_SCOPE, ...slugs];

  const userName = config.identity.user_name;
  const batch = buildConversationBatch(pendingMessages, userName, config.identity.timezone);
  if (!batch || batch.messages.length < minMessages) return 0;
  const conversationBlock = batch.text;
  const batchStartSeq = batch.messages[0].sequence;
  const batchMaxSeq = batch.maxSequence;

  const blocks = getBlocksForScopes(scopes);
  const blocksText = blocks.length
    ? blocks.map((b) => `[${b.scope}] ${b.label}${b.description ? ` — ${b.description}` : ''}\n${b.content || '(empty)'}`).join('\n\n')
    : '(no blocks yet)';

  const prompt = `Current memory blocks:

---
${blocksText}
---

New conversation from thread "${activity.thread_name}":

---
${conversationBlock}
---

Output the JSON array of memory edit operations now.`;

  // Extraction rides the BYOK router lane (Ollama Cloud by default) — never
  // the Agent SDK, which spawns the claude binary in print mode and bills
  // outside the subscription. Provider/model live in config so they can be
  // changed from the DB (agent.archivist_provider / agent.archivist_model).
  // Codex is the exception: the generic router rejects those models outright,
  // so they go through CodexRuntime instead. That lane rides the ChatGPT
  // subscription, so it stays clear of metered Anthropic billing too.
  const provider = config.agent.archivist_provider || 'ollama';
  const model = config.agent.archivist_model || 'deepseek-v4-pro';
  const backlogNote = batchMaxSeq < activity.max_seq ? `; backlog remains through ${activity.max_seq}` : '';
  mlog(`${activity.thread_name}: assessing ${batch.messages.length} new messages via ${provider}/${model} (seq ${batchStartSeq}–${batchMaxSeq}${backlogNote}, scopes: ${scopes.join(', ')})`);

  const systemPrompt = buildArchivistPrompt(userName, slugs, names);
  let raw: string;
  if (provider === 'sdk') {
    // Backend-only on purpose — this provider is deliberately absent from the
    // model picker. See archivist-sdk.ts for the billing question it carries.
    const sdk = await extractViaClaudeSdk(systemPrompt, prompt, model);
    raw = sdk.text;
    mlog(
      `sdk lane: ${model} reported cost ${sdk.costUsd === null ? 'nothing' : `$${sdk.costUsd.toFixed(4)}`}` +
      ` in ${Math.round(sdk.durationMs / 1000)}s` +
      (sdk.usage ? ` — usage ${JSON.stringify(sdk.usage)}` : ''),
    );
  } else if (provider === 'codex') {
    raw = await extractViaCodex(
      systemPrompt,
      prompt,
      model,
      config.agent.archivist_effort || 'adaptive',
      config.agent.archivist_thinking || 'disabled',
    );
  } else {
    raw = await extractViaRouter(systemPrompt, prompt, model, provider);
  }
  // Reasoning models may prepend <think> blocks — drop them before parsing.
  raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '');

  let ops: MemoryOp[] = [];
  try {
    ops = parseOps(raw);
  } catch (err) {
    const snippet = raw.replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`unparseable extractor output, cursor held — ${err instanceof Error ? err.message : err}; raw: ${snippet}`);
  }

  const { applied, skipped } = applyOps(ops, threadId);
  setExtractionCursor(threadId, batchMaxSeq);
  const verb = archivistMode() === 'write' ? 'applied' : 'handed over';
  mlog(`${activity.thread_name}: ${ops.length} ops proposed, ${applied} ${verb}${skipped.length ? `, skipped: ${skipped.join(' | ')}` : ''}`);
  return applied;
}

export async function runMemoryExtraction(
  agent?: AgentService,
  onlyThreadId?: string
): Promise<{ processed: number; applied: number; failed: number }> {
  setConfig('memext.last_attempt_at', new Date().toISOString());
  // THE BILLING WITNESS. Two comments in this codebase say a Claude path
  // outside the warm CLI lane bills metered credits; the other reading is that
  // the SDK rides the subscription. Rather than argue it, read the owner's weekly
  // before and after a sweep that used it. NOTE: the usage reader caches for
  // 60s, so a sweep shorter than that will report an unchanged number for a
  // boring reason — both readings are logged so a flat result is visible as
  // possibly stale rather than mistaken for proof.
  const usingSdkLane = getConfig('agent.archivist_provider') === 'sdk';
  const weeklyBefore = usingSdkLane ? await claudeWeeklyPercent() : null;
  if (agent?.isProcessing()) {
    mlog('Skipped — agent is processing');
    return { processed: 0, applied: 0, failed: 0 };
  }

  const manual = Boolean(onlyThreadId);
  let candidates = threadsWithActivity();
  if (onlyThreadId) {
    candidates = candidates.filter((t) => t.thread_id === onlyThreadId);
    if (candidates.length === 0) {
      const row = getDb().prepare(`
        SELECT m.thread_id, t.name AS thread_name, MAX(m.sequence) AS max_seq
        FROM messages m JOIN threads t ON t.id = m.thread_id
        WHERE m.thread_id = ? AND m.deleted_at IS NULL AND m.content_type = 'text'
        GROUP BY m.thread_id
      `).get(onlyThreadId) as ThreadActivity | undefined;
      if (row) candidates = [row];
    }
  }

  let processed = 0;
  let applied = 0;
  const failures: string[] = [];
  for (const activity of candidates) {
    if (processed >= MAX_THREADS_PER_RUN && !manual) break;
    const cursor = getExtractionCursor(activity.thread_id);
    if (cursor >= activity.max_seq && !manual) continue;
    try {
      const n = await extractFromThread(activity, manual);
      if (n >= 0) processed++;
      applied += n;
    } catch (err) {
      const detail = `${activity.thread_name}: ${err instanceof Error ? err.message : err}`;
      failures.push(detail);
      mlog(`${activity.thread_name}: extraction failed — ${err instanceof Error ? err.message : err}`);
    }
  }

  if (usingSdkLane && processed > 0) {
    const weeklyAfter = await claudeWeeklyPercent();
    mlog(
      `sdk lane billing witness: Claude weekly ${weeklyBefore ?? '?'}% before, ${weeklyAfter ?? '?'}% after` +
      (weeklyBefore !== null && weeklyAfter !== null && weeklyBefore === weeklyAfter
        ? ' (unchanged — may be the 60s usage cache rather than a free lane)'
        : ''),
    );
  }

  const finishedAt = new Date().toISOString();
  setConfig('memext.last_run_at', finishedAt);
  if (failures.length > 0) {
    setConfig('memext.last_outcome', 'error');
    setConfig('memext.last_error', failures.join(' | ').slice(0, 1200));
  } else {
    setConfig('memext.last_outcome', 'ok');
    setConfig('memext.last_error', '');
    setConfig('memext.last_success_at', finishedAt);
  }

  return { processed, applied, failed: failures.length };
}

/** The owner's weekly Claude percentage, or null when it cannot be read. Used only as
 *  the before/after witness on the SDK lane — never to gate anything. */
async function claudeWeeklyPercent(): Promise<number | null> {
  try {
    const { getClaudeUsage } = await import('./subscription-usage.js');
    const usage = await getClaudeUsage();
    const weekly = usage.limits?.find((limit) => limit.kind?.includes('week') && !/fable/i.test(limit.label));
    return typeof weekly?.percent === 'number' ? weekly.percent : null;
  } catch {
    return null;
  }
}

let extractionTimer: ReturnType<typeof setInterval> | null = null;

/** Sweeps used to run every 45 minutes. Halved to two-hourly, because the
 *  Archivist is the only thing on this box that spends a meter without anybody
 *  asking it to. Override with agent.archivist_interval_minutes. */
export const DEFAULT_EXTRACTION_INTERVAL_MINUTES = 120;

/** Explicit argument wins, then the owner's config, then the two-hour default. A
 *  configured zero or a typo must not turn the sweep into a tight loop. */
export function resolveExtractionInterval(
  explicit: number | undefined,
  configured: string | null | undefined,
): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) return explicit;
  const parsed = Number(configured);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_EXTRACTION_INTERVAL_MINUTES;
}

export function startMemoryExtraction(agent: AgentService, intervalMinutes?: number): void {
  if (extractionTimer) return;
  intervalMinutes = resolveExtractionInterval(intervalMinutes, getConfig('agent.archivist_interval_minutes'));
  extractionTimer = setInterval(() => {
    runMemoryExtraction(agent).catch((err) => mlog(`scheduled run failed: ${err instanceof Error ? err.message : err}`));
  }, intervalMinutes * 60_000);
  mlog(`Archivist scheduled every ${intervalMinutes} minutes`);
}

export function stopMemoryExtraction(): void {
  if (extractionTimer) {
    clearInterval(extractionTimer);
    extractionTimer = null;
  }
}
