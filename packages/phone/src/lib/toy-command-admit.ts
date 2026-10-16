// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * The first question a command from a lane is asked on the owner's phone. A stop is
 * let through before anything else, however late it arrives, because a stop
 * that is refused leaves the play it was meant to end still running. Only a
 * play can be too old to act on.
 */
export function admitCommand(command: { action: string; at: string }, now: number, staleMs: number): 'stop' | 'stale' | 'play' {
  if (command.action === 'stop') return 'stop';
  const sentAt = Date.parse(command.at);
  if (Number.isFinite(sentAt) && now - sentAt > staleMs) return 'stale';
  return 'play';
}
