// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
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

import { existsSync, readFileSync, writeFileSync } from 'fs';
import crypto from 'crypto';
import { getDb } from './db/state.js';
import { KNOWN_BACKENDS, planAttempts, runWithFallback, type ImageBackend } from './image-fallback.js';
import { IMAGE_GEN_ENGINE, JOBS_FILE, getImageGenSettings } from './image-gen/settings.js';
import { GenerateInput, GenerateResult, ImageGenError } from './image-gen/common.js';
import { generateViaCodex } from './image-gen/codex.js';
import { generateViaAntigravity } from './image-gen/antigravity.js';
import { generateViaOpenArt } from './image-gen/openart.js';
import { generateViaOpenAi } from './image-gen/openai.js';
import { cancelHooks, clearRunningJob, onRunningJobCancel, setRunningJob } from './image-gen/cancel.js';

export * from './image-gen/cancel.js';
export * from './image-gen/settings.js';
export * from './image-gen/drawers.js';
export * from './image-gen/gallery.js';
export * from './image-gen/common.js';
export * from './image-gen/codex.js';
export * from './image-gen/antigravity.js';
export * from './image-gen/openart.js';
export * from './image-gen/openai.js';
/** Only the metered backend is capped, and only when their person has set a figure. */
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
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
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

export function cancelImageJob(id: string): { ok: boolean; status?: ImageJob['status']; reason?: string } {
  const job = jobs.get(id);
  if (!job) return { ok: false, reason: 'not found' };
  if (job.status !== 'pending' && job.status !== 'running') return { ok: false, status: job.status, reason: 'already finished' };
  const wasRunning = job.status === 'running';
  job.status = 'cancelled';
  job.error = 'Cancelled.';
  job.completedAt = Date.now();
  persistJobs();
  if (wasRunning) {
    for (const kill of cancelHooks.get(id) ?? []) {
      try { kill(); } catch { /* already gone */ }
    }
    cancelHooks.delete(id);
  }
  return { ok: true, status: 'cancelled' };
}

export function getJobStatus(id: string): ImageJob | undefined {
  return jobs.get(id);
}

export function listImageJobs(): ImageJob[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Queue a picture and return its job id at once.
 *
 * onFailure is for a caller that records the job somewhere of its own and
 * otherwise has no way to hear that it failed. It runs after the job is marked
 * failed, and a hook that throws is logged, never turned into a second failure.
 */
export function startGenerateJob(
  input: GenerateInput,
  onComplete?: (result: GenerateResult) => Promise<void> | void,
  onFailure?: (error: string) => Promise<void> | void,
): string {
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
    if (job.status === 'cancelled') {
      try { await onFailure?.('Cancelled.'); } catch (error) { console.warn('[image-gen] failure hook threw:', error); }
      return;
    }
    job.status = 'running';
    setRunningJob(id);
    persistJobs();
    let failure: string | null = null;
    let release: () => void = () => undefined;
    const cancelled = new Promise<never>((_, reject) => {
      release = onRunningJobCancel(() => reject(new ImageGenError('Cancelled.')));
    });
    cancelled.catch(() => undefined);
    try {
      const result = await Promise.race([generateImage(input), cancelled]);
      try {
        await onComplete?.(result);
      } catch (error) {
        // The image exists even if its gallery index write hiccups. Never turn
        // a successful render into a fake failure because its filing failed.
        console.warn('[image-gen] gallery metadata write failed:', error);
      }
      if ((job.status as ImageJob['status']) !== 'cancelled') {
        job.status = 'completed';
        job.result = result;
      }
    } catch (err) {
      if ((job.status as ImageJob['status']) !== 'cancelled') {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
        failure = job.error;
      } else {
        failure = 'Cancelled.';
      }
    } finally {
      release();
      cancelHooks.delete(id);
      clearRunningJob(id);
      if (!job.completedAt || (job.status as ImageJob['status']) !== 'cancelled') job.completedAt = Date.now();
      persistJobs();
    }
    if (failure !== null && onFailure) {
      try {
        await onFailure(failure);
      } catch (error) {
        console.warn('[image-gen] failure hook threw:', error);
      }
    }
  });

  return id;
}
