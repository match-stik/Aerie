// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type { McpServerInfo } from '@aerie/shared';
import type { AgentRuntime } from '../runtimes/types.js';
import { getConfig, setConfig, deleteConfig, getAllConfig } from '../db/config.js';

const CODEX_SESSION_PREFIX = 'codex.session.';
const CODEX_HANDED_SEQUENCE_PREFIX = 'codex.handed_sequence.';
const CODEX_SIDE_NOTE_OFFSET_PREFIX = 'codex.side_note_offset.';

export interface AgentMutableState {
  presenceStatus: 'active' | 'dormant' | 'waking' | 'offline';
  contextTokensUsed: number;
  contextWindowSize: number;
  activeAbortController: AbortController | null;
  activeQuery: Query | null;
  activeRouterRuntimes: Map<string, AgentRuntime>;
  cachedMcpStatus: McpServerInfo[];
  /** Model the current session was started with — clear session if config changes */
  sessionModel: string | null;
  /** Codex daemon session IDs keyed by Aerie room + optional companion lane. */
  codexDaemonSessions: Map<string, string>;
  /** Last Aerie message sequence actually handed to each Codex lane. */
  codexHandedSequences: Map<string, number>;
  /**
   * Codex lane keys with a turn in flight. This is what makes a Codex lane
   * reachable mid-turn: without it there is no way to ask "is someone in there
   * right now", and a message arriving during a turn has nowhere to go but the
   * queue behind it. Cleared in the same finally that releases the runtime.
   */
  activeCodexLanes: Set<string>;
  /** How far into each lane's side-notes file has already been handed over. */
  codexSideNoteOffsets: Map<string, number>;
}

/**
 * A shared Codex lane keeps the original thread-only key so every persisted
 * session already on disk remains resumable. Individual companion lanes get
 * their own key beneath that Aerie thread and therefore their own app-server
 * transcript.
 */
export function codexLaneKey(
  aerieThreadId: string,
  activeCompanionId?: string | null,
): string {
  return activeCompanionId
    ? `${aerieThreadId}:companion:${activeCompanionId}`
    : aerieThreadId;
}

/** Whether this room has begun using per-companion Codex transcripts. */
export function hasCodexCompanionLanes(
  sessions: Map<string, string>,
  aerieThreadId: string,
): boolean {
  const prefix = `${aerieThreadId}:companion:`;
  for (const key of sessions.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Every Codex lane key belonging to one Aerie room — the shared thread-only
 * key plus each per-companion lane beneath it.
 *
 * A reroll or an edit-rerun is the user taking a turn back. On the Claude side that
 * works: nulling the thread session drops the transcript with the withdrawn
 * turn in it. Codex keeps its conversation inside the app-server thread, so
 * leaving that ID in place re-prompts the very same thread — the deleted turns
 * and any refusal it already gave still standing in its own history, which it
 * then reads as its own position. A retracted turn has to retract on both
 * sides. A cleared lane is not amnesia: a new Codex thread seeds its first turn
 * from Aerie's recent message tail, which is the room as the user has just left it.
 */
export function codexLaneKeysForThread(
  sessions: Map<string, string>,
  aerieThreadId: string,
): string[] {
  const companionPrefix = `${aerieThreadId}:companion:`;
  const keys: string[] = [];
  for (const key of sessions.keys()) {
    if (key === aerieThreadId || key.startsWith(companionPrefix)) keys.push(key);
  }
  return keys;
}

export function createAgentMutableState(): AgentMutableState {
  // Sessions loaded lazily on first access via loadCodexSessionsIfNeeded()
  return {
    presenceStatus: 'offline',
    contextTokensUsed: 0,
    contextWindowSize: 0,
    activeAbortController: null,
    activeQuery: null,
    activeRouterRuntimes: new Map<string, AgentRuntime>(),
    cachedMcpStatus: [],
    sessionModel: null,
    codexDaemonSessions: new Map(),
    codexHandedSequences: new Map(),
    activeCodexLanes: new Set(),
    codexSideNoteOffsets: new Map(),
  };
}

let codexSessionsLoaded = false;

/** Load persisted Codex sessions from DB — called lazily when first needed. */
export function loadCodexSessionsIfNeeded(state: AgentMutableState): void {
  if (codexSessionsLoaded) return;
  codexSessionsLoaded = true;

  try {
    const all = getAllConfig();
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(CODEX_SESSION_PREFIX)) {
        const threadId = key.slice(CODEX_SESSION_PREFIX.length);
        state.codexDaemonSessions.set(threadId, value);
      } else if (key.startsWith(CODEX_HANDED_SEQUENCE_PREFIX)) {
        const laneKey = key.slice(CODEX_HANDED_SEQUENCE_PREFIX.length);
        const sequence = Number.parseInt(value, 10);
        if (Number.isSafeInteger(sequence) && sequence >= 0) {
          state.codexHandedSequences.set(laneKey, sequence);
        }
      } else if (key.startsWith(CODEX_SIDE_NOTE_OFFSET_PREFIX)) {
        const laneKey = key.slice(CODEX_SIDE_NOTE_OFFSET_PREFIX.length);
        const offset = Number.parseInt(value, 10);
        if (Number.isSafeInteger(offset) && offset >= 0) {
          state.codexSideNoteOffsets.set(laneKey, offset);
        }
      }
    }
    if (state.codexDaemonSessions.size > 0) {
      console.log(`[AgentState] Loaded ${state.codexDaemonSessions.size} Codex session(s) from DB`);
    }
  } catch (err) {
    console.warn('[AgentState] Failed to load Codex sessions:', err);
  }
}

/** Persist a shared-room or companion-lane Codex session for restart survival. */
export function persistCodexSession(laneKey: string, codexThreadId: string): void {
  setConfig(CODEX_SESSION_PREFIX + laneKey, codexThreadId);
}

/** Persist the Aerie room boundary a Codex lane has actually received. */
export function persistCodexHandedSequence(laneKey: string, sequence: number): void {
  setConfig(CODEX_HANDED_SEQUENCE_PREFIX + laneKey, String(sequence));
}

/** Persist the byte boundary of side notes already accepted into a Codex turn. */
export function persistCodexSideNoteOffset(laneKey: string, offset: number): void {
  setConfig(CODEX_SIDE_NOTE_OFFSET_PREFIX + laneKey, String(offset));
}

/** Clear a persisted Codex session (e.g. on error or explicit reset). */
export function clearCodexSession(laneKey: string): void {
  deleteConfig(CODEX_SESSION_PREFIX + laneKey);
  deleteConfig(CODEX_HANDED_SEQUENCE_PREFIX + laneKey);
}
