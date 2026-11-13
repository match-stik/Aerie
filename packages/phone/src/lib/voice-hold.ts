// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * Whether a voice call keeps waiting for more of a chunked reply after a pause.
 * It holds while the house says a turn is running and releases when the turn
 * ends, so a chunk written after minutes of work is still spoken (a single
 * 20 s wait used to hand the call back to listening first). The cap matches the house's
 * own 20-minute limit on a held turn, for a lane that never drops out of active.
 */
export const CONTINUATION_MAX_MS = 20 * 60_000;

export function keepHoldingForMore(
  arriving: { presence?: string | null; streamingMessageId?: string | null },
  waitedMs: number,
  maxMs: number = CONTINUATION_MAX_MS,
): boolean {
  if (waitedMs >= maxMs) return false;
  return arriving.presence === 'active' || arriving.presence === 'waking' || !!arriving.streamingMessageId;
}
