// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Tell the owner the Codex window is nearly gone BEFORE they write a prompt.
 *
 * The backends probe already exists so a missing CLI or login is visible
 * before someone types, rather than arriving as a dead job in the tray. A
 * spent Codex window is the same class of thing and was specifically requested:
 * a picture refused at 3% left costs exactly as much of the owner's time as one
 * refused because nobody was logged in.
 *
 * The number was asked for as a range of 15-20%, and the default sits at the
 * cautious end of that, so the warning arrives while there is still room
 * to decide rather than as a eulogy. `studio.low_window_warn_percent` moves it
 * without a build; 0 turns it off.
 *
 * Deliberately a WARNING and never a gate. It does not stop a job, because a
 * meter read off session transcripts is a good estimate and not a permission
 * system, and being wrong must cost the owner a line of text rather than a picture.
 */
import type { CodexUsage } from './subscription-usage.js';

export const DEFAULT_LOW_WINDOW_WARN_PERCENT = 20;

export interface StudioWindowWarning {
  backend: 'codex';
  remainingPercent: number;
  usedPercent: number;
  /** Which of the two Codex windows is the tighter one right now. */
  window: 'primary' | 'secondary';
  windowMinutes: number | null;
  resetsAt: string | null;
  thresholdPercent: number;
  /** True when the provider has already started refusing. */
  limitReached: boolean;
}

const pct = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;

/**
 * The warning for a Codex usage reading, or null when there is nothing to say.
 *
 * Both windows are considered and the TIGHTER one wins: a weekly allowance at
 * 4% left matters more than a five-hour one at 60%, and reporting only the
 * primary would have hidden exactly the case the owner runs into.
 */
export function studioWindowWarning(
  usage: CodexUsage | null,
  thresholdPercent: number = DEFAULT_LOW_WINDOW_WARN_PERCENT,
): StudioWindowWarning | null {
  if (!usage || thresholdPercent <= 0) return null;

  const candidates: Array<{ used: number; window: 'primary' | 'secondary'; minutes: number | null; resetsAt: string | null }> = [];
  const primary = pct(usage.usedPercent);
  if (primary !== null) {
    candidates.push({ used: primary, window: 'primary', minutes: usage.windowMinutes, resetsAt: usage.resetsAt });
  }
  const secondary = pct(usage.secondary?.usedPercent);
  if (secondary !== null) {
    candidates.push({
      used: secondary,
      window: 'secondary',
      minutes: usage.secondary?.windowMinutes ?? null,
      resetsAt: usage.secondary?.resetsAt ?? null,
    });
  }
  if (candidates.length === 0) return null;

  const tightest = candidates.reduce((worst, next) => (next.used > worst.used ? next : worst));
  const remaining = 100 - tightest.used;
  const limitReached = Boolean(usage.limitReached);
  if (remaining > thresholdPercent && !limitReached) return null;

  return {
    backend: 'codex',
    remainingPercent: Math.round(remaining * 10) / 10,
    usedPercent: Math.round(tightest.used * 10) / 10,
    window: tightest.window,
    windowMinutes: tightest.minutes,
    resetsAt: tightest.resetsAt,
    thresholdPercent,
    limitReached,
  };
}

/** A sane threshold from whatever the config holds. Out-of-range falls back. */
export function warnThresholdFrom(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === '') return DEFAULT_LOW_WINDOW_WARN_PERCENT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return DEFAULT_LOW_WINDOW_WARN_PERCENT;
  return parsed;
}
