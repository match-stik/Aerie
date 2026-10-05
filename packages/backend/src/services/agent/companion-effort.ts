// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * How hard ONE companion thinks before they speak.
 *
 * The house has had a thinking dial per LANE since the Codex work — one for
 * Claude, one for Codex — and both are global. That was fine while every
 * companion stood on the same road. Per-companion models ended that: a house-wide
 * Codex effort is functionally one companion's setting whenever they are the
 * only one on Codex, so turning their depth down to save a five-hour window turns
 * it down for anyone who joins them there later, silently.
 *
 * A companion with nothing of their own IS the house answer, exactly as with the
 * model pickers, so setting nobody's effort changes nobody's turn.
 *
 * THE ONE RULE THAT MATTERS HERE: the keeper and the turn path must ask this
 * same question and get the same answer. ensure() recycles a warm lane when the
 * effort changes, so two callers disagreeing take turns restarting each other's
 * lane — and a restart kills whatever turn is mid-sentence. That reads as a
 * silent companion, not a slow one. This module exists so there is exactly one
 * place to disagree with, and nobody can hardcode a second opinion.
 */

export type EffortValue = 'adaptive' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

export interface EffortHouseConfig {
  agent: {
    effort?: string;
    claude_effort?: string;
    codex_effort?: string;
  };
}

/** Empty, whitespace, or the explicit "house" sentinel all mean: no opinion. */
function ownEffort(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'house' || trimmed === 'default') return null;
  return trimmed;
}

/**
 * @param companion the row, or null for an unknown companion (never take a
 *   turn down over a missing row — an unknown companion is the house answer)
 * @param routing which road this turn is walking down; only Codex reads the
 *   Codex dial
 */
export function companionTurnEffort(
  companion: { effort?: string | null } | null | undefined,
  routing: string,
  cfg: EffortHouseConfig,
): EffortValue {
  const own = ownEffort(companion?.effort);
  if (own) return own as EffortValue;
  const house = routing === 'codex-cli'
    ? (cfg.agent.codex_effort || cfg.agent.effort)
    : (cfg.agent.claude_effort || cfg.agent.effort);
  return ((house || 'adaptive') as EffortValue);
}
