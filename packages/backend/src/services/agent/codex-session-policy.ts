// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { DoneEvent } from '../runtimes/types.js';

export type CodexSessionDisposition =
  | { action: 'commit'; sessionId: string }
  | { action: 'preserve'; sessionId: string }
  | { action: 'clear'; sessionId: string | null };

/**
 * Decide what to do with a Codex app-server thread after an Aerie turn.
 *
 * An Aerie timeout only means our polling window closed. It does not prove the
 * app-server thread vanished or lost its conversation. Dropping that ID made
 * the next message start from persona/core memory alone, severing the recent
 * conversational frame. Preserve the thread across timeouts; truly failed
 * turns may still discard it so the stale-thread recovery path can take over.
 */
export function codexSessionDisposition(params: {
  finishReason: DoneEvent['finishReason'];
  runtimeError: string | null;
  hasResponse: boolean;
  pendingSessionId: string | null;
  existingSessionId: string | null;
  isAutonomous?: boolean;
}): CodexSessionDisposition {
  const { finishReason, runtimeError, hasResponse, pendingSessionId, existingSessionId, isAutonomous = false } = params;
  const sessionId = pendingSessionId || existingSessionId;

  if (finishReason === 'timeout' && sessionId) {
    return { action: 'preserve', sessionId };
  }

  // A successful resumed turn is still the same healthy conversation. The
  // runtime only emits a `session` event when it creates a new Codex thread,
  // so requiring pendingSessionId here made every second interactive turn
  // erase the persisted warm-thread ID after it answered.
  if (!runtimeError && finishReason !== 'timeout' && hasResponse && sessionId) {
    return { action: 'commit', sessionId };
  }

  // A background wake must never destroy the interactive thread it borrowed.
  // Leave stale-thread recovery to the next interactive turn, where failure is
  // visible and the user can intentionally replace that session.
  if (isAutonomous && existingSessionId) {
    return { action: 'preserve', sessionId: existingSessionId };
  }

  return { action: 'clear', sessionId };
}
