// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
export interface SequencedAerieMessage {
  sequence: number;
  role: 'user' | 'companion' | 'system';
  content: string;
}

export interface CodexCatchUpMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Select the bounded slice of Aerie conversation a resumed Codex transcript
 * has not been handed yet.
 *
 * `handThroughSequence` belongs to this turn. Keeping it explicit prevents a
 * second message that reached SQLite while this one waited in the queue from
 * leaking into the earlier turn. An existing pre-bookmark session receives one
 * bounded tail, then the normal per-lane bookmark takes over.
 */
export function selectCodexCatchUpHistory(
  messages: SequencedAerieMessage[],
  lastHandedSequence: number | undefined,
  handThroughSequence: number,
  limit = 30,
  liveInboundSequence?: number,
): CodexCatchUpMessage[] {
  const floor = lastHandedSequence ?? Number.NEGATIVE_INFINITY;
  return messages
    .filter((message) => (
      message.role !== 'system'
      && message.sequence > floor
      && message.sequence <= handThroughSequence
      && message.sequence !== liveInboundSequence
    ))
    .slice(-limit)
    .map((message) => ({
      role: message.role === 'user' ? 'user' : 'assistant',
      content: message.content,
    }));
}
