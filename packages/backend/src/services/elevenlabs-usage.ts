// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * ElevenLabs subscription usage — shape + parser for the phone's credit
 * meter. The API key needs the user_read permission (enabled Jul 21, 2026).
 */

export interface ElevenLabsUsage {
  tier: string;
  characterCount: number;
  characterLimit: number;
  remaining: number;
  usedPercent: number;
  nextResetAt: string | null;
}

export function parseElevenLabsSubscription(raw: Record<string, unknown>): ElevenLabsUsage {
  const characterCount = typeof raw.character_count === 'number' ? raw.character_count : 0;
  const characterLimit = typeof raw.character_limit === 'number' ? raw.character_limit : 0;
  const resetUnix = typeof raw.next_character_count_reset_unix === 'number'
    ? raw.next_character_count_reset_unix
    : null;
  return {
    tier: typeof raw.tier === 'string' ? raw.tier : 'unknown',
    characterCount,
    characterLimit,
    remaining: Math.max(0, characterLimit - characterCount),
    usedPercent: characterLimit > 0
      ? Math.min(100, Math.round((characterCount / characterLimit) * 1000) / 10)
      : 0,
    nextResetAt: resetUnix ? new Date(resetUnix * 1000).toISOString() : null,
  };
}
