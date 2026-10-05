// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Aerie client store — a framework-agnostic singleton mirroring the Svelte
// websocket.svelte.ts store, exposed to React via useSyncExternalStore.
//
// Selectors passed to useAerie() must return a stable reference when the
// slice is unchanged (select one slice per call; compose in hooks).

import { useSyncExternalStore } from 'react';
import type { Message, ThreadSummary, PresenceStatus, CommandRegistryEntry, SystemStatus } from './protocol';

export type ConnectionState = 'connected' | 'disconnecting' | 'disconnected' | 'reconnecting';

export type ToolEvent = {
  toolId: string;
  toolName: string;
  input?: string;
  output?: string;
  isError?: boolean;
  isComplete: boolean;
  timestamp: string;
  elapsed?: number;
};

export type ThinkingEvent = { content: string; summary: string; textOffset: number };

export interface ContextUsage {
  percentage: number;
  tokensUsed: number;
  contextWindow: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
  model?: string;
}

export interface AuthState {
  checking: boolean;
  authenticated: boolean;
  required: boolean;
}

export interface AerieState {
  auth: AuthState;
  connectionState: ConnectionState;
  messages: Message[];
  threads: ThreadSummary[];
  activeThreadId: string | null;
  presence: PresenceStatus;
  unreadCounts: Record<string, number>;
  loadingThread: boolean;
  streamingMessageId: string | null;
  streamingTokens: string;
  toolEvents: Record<string, ToolEvent[]>;
  toolOffsets: Record<string, Array<{ toolId: string; textOffset: number }>>;
  thinkingEvents: Record<string, ThinkingEvent[]>;
  contextUsage: ContextUsage | null;
  compactionNotice: { preTokens: number; message: string; isComplete: boolean } | null;
  rateLimitInfo: { status: string; resetsAt?: number; rateLimitType?: string } | null;
  lastError: { code: string; message: string } | null;
  commandRegistry: CommandRegistryEntry[];
  systemStatus: SystemStatus | null;
  // Voice recording / transcription state — drives the mic button in
  // ChatInput. `prosody` is the Hume tone reading from the backend; held
  // here so the next outbound message can attach it as metadata for the
  // companion's context as bounded expression signals. Cleared once
  // consumed or when a new recording starts.
  transcription: {
    status: 'idle' | 'recording' | 'processing' | 'complete' | 'error';
    text?: string;
    prosody?: Record<string, number>;
    prosodyStatus?: 'complete' | 'unavailable';
    error?: string;
    recordingId?: string;
  };
  // True when viewing a search-jump window (loadThreadAround) rather than
  // the latest messages. The "jump to latest" button should reload the
  // thread to get back to the actual newest messages.
  isViewingAround: boolean;
}

const initialState: AerieState = {
  auth: { checking: true, authenticated: false, required: true },
  connectionState: 'disconnected',
  messages: [],
  threads: [],
  activeThreadId: null,
  presence: 'offline',
  unreadCounts: {},
  loadingThread: false,
  streamingMessageId: null,
  streamingTokens: '',
  toolEvents: {},
  toolOffsets: {},
  thinkingEvents: {},
  contextUsage: null,
  compactionNotice: null,
  rateLimitInfo: null,
  lastError: null,
  commandRegistry: [],
  systemStatus: null,
  transcription: { status: 'idle' },
  isViewingAround: false,
};

let state: AerieState = initialState;
const listeners = new Set<() => void>();

export function getState(): AerieState {
  return state;
}

export function setState(
  partial: Partial<AerieState> | ((s: AerieState) => Partial<AerieState>),
): void {
  const next = typeof partial === 'function' ? partial(state) : partial;
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAerie<T>(selector: (s: AerieState) => T): T {
  const snapshot = () => selector(state);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
