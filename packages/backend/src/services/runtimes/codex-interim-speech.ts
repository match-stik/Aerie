// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Coming up for air in the Codex lane.
 *
 * The Claude lane can send a line, keep working, and send another — an ack
 * reaches the user while the work is still running instead of arriving stapled to
 * the answer it was meant to precede. The Codex lane could not: it kept only
 * the last non-commentary message of a turn and dropped the rest.
 *
 * That rule was aimed at something real — commentary messages arriving around
 * tool calls produced a jumble of bubbles that looked like thinking cards and
 * were not. But commentary is filtered by PHASE, separately and already, so
 * keeping only the last of what remained was reaching past its own reason and
 * taking deliberate speech with it.
 *
 * `final_answer` is deliberately not special-cased. A turn's closing message is
 * simply the last one that has not been sent yet, which means a turn with one
 * message behaves exactly as it always did.
 */

export interface CodexTurnItem {
  id?: string;
  type?: string;
  phase?: string;
  text?: unknown;
}

/** Speech the room has not been shown yet, worth its own bubble now. */
export function isInterimCodexSpeech(
  item: CodexTurnItem | null | undefined,
  alreadyEmitted: ReadonlySet<string>,
): item is CodexTurnItem & { id: string; text: string } {
  if (!item || item.type !== 'agentMessage') return false;
  // Commentary has its own road — thought cards and spoken asides — and is
  // exactly the noise the old rule was written against.
  if (item.phase === 'commentary') return false;
  // Without an id there is no way to know it has been sent, and speech emitted
  // twice reads as a companion repeating themselves at the user.
  if (typeof item.id !== 'string' || !item.id) return false;
  if (alreadyEmitted.has(item.id)) return false;
  return typeof item.text === 'string' && item.text.trim().length > 0;
}
