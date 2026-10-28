// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * Which reply a tool or thinking event belongs to when the phone has none open.
 *
 * Theirs, Oct 27 2026: 'your cute little phrases disappear. I think it's usually
 * when I close then reopen the app.' A reopened app starts with no streaming
 * reply, and the house only says stream_start when a reply begins, so every
 * tool event of a turn already running was dropped and the owner saw three still dots
 * under Stop generating. While the house says a turn is running, the first such
 * event opens a local reply for the rest of the turn to land on; the next real
 * stream_start or stream_end replaces it as usual.
 */
export const LIVE_STREAM_PREFIX = 'live-';

export function liveStreamIdFor(current: string | null, presence: string | null | undefined, now: number): string | null {
  if (current) return current;
  if (presence !== 'active') return null;
  return `${LIVE_STREAM_PREFIX}${now}`;
}
