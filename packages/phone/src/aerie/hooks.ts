// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// React hooks over the Aerie store. Each useAerie() call selects a
// single slice so useSyncExternalStore sees stable references.

import { useMemo } from 'react';
import { useAerie } from './store';
import type { AerieState, ToolEvent, ThinkingEvent } from './store';
import type { MessageSegment } from './protocol';

export const useConnectionState = () => useAerie((s) => s.connectionState);
export const useAuth = () => useAerie((s) => s.auth);
export const useMessages = () => useAerie((s) => s.messages);
export const useThreads = () => useAerie((s) => s.threads);
export const useActiveThreadId = () => useAerie((s) => s.activeThreadId);
export const usePresence = () => useAerie((s) => s.presence);
export const useUnreadCounts = () => useAerie((s) => s.unreadCounts);
export const useLastError = () => useAerie((s) => s.lastError);
export const useContextUsage = () => useAerie((s) => s.contextUsage);
export const useCompactionNotice = () => useAerie((s) => s.compactionNotice);
export const useRateLimitInfo = () => useAerie((s) => s.rateLimitInfo);
export const useLoadingThread = () => useAerie((s) => s.loadingThread);
export const useCommandRegistry = () => useAerie((s) => s.commandRegistry);
export const useSystemStatus = () => useAerie((s) => s.systemStatus);
export const useIsStreaming = () => useAerie((s) => s.streamingMessageId !== null);

export function useStreaming(): { messageId: string | null; tokens: string } {
  const messageId = useAerie((s) => s.streamingMessageId);
  const tokens = useAerie((s) => s.streamingTokens);
  return { messageId, tokens };
}

// Total unread across all threads.
export function useTotalUnread(): number {
  const counts = useUnreadCounts();
  return useMemo(() => Object.values(counts).reduce((sum, n) => sum + n, 0), [counts]);
}

type StreamingSlices = Pick<
  AerieState,
  'streamingMessageId' | 'streamingTokens' | 'toolOffsets' | 'thinkingEvents' | 'toolEvents'
>;

// Stale tool timeout disabled — was interfering with long-running CLI operations

// Port of websocket.svelte.ts getStreamingSegments() — merges tool + thinking
// insertions into the streaming text, ordered by text offset.
export function buildStreamingSegments(s: StreamingSlices): MessageSegment[] | null {
  const { streamingMessageId, streamingTokens } = s;
  if (!streamingMessageId) return null;
  const offsets = s.toolOffsets[streamingMessageId] || [];
  const thinking = s.thinkingEvents[streamingMessageId] || [];
  if (offsets.length === 0 && thinking.length === 0) return null;

  const events: ToolEvent[] = s.toolEvents[streamingMessageId] || [];
  const eventMap = new Map(events.map((e) => [e.toolId, e]));

  type Insertion = { textOffset: number } & (
    | { kind: 'tool'; toolId: string }
    | { kind: 'thinking'; content: string; summary: string }
  );

  const insertions: Insertion[] = [
    ...offsets.map((o) => ({ textOffset: o.textOffset, kind: 'tool' as const, toolId: o.toolId })),
    ...thinking.map((t: ThinkingEvent) => ({
      textOffset: t.textOffset,
      kind: 'thinking' as const,
      content: t.content,
      summary: t.summary,
    })),
  ].sort((a, b) => a.textOffset - b.textOffset);

  const text = streamingTokens;
  const segments: MessageSegment[] = [];
  let cursor = 0;

  for (const ins of insertions) {
    const offset = Math.min(ins.textOffset, text.length);
    if (offset > cursor) {
      segments.push({ type: 'text', content: text.slice(cursor, offset) });
    }
    if (ins.kind === 'tool') {
      const ev = eventMap.get(ins.toolId);
      segments.push({
        type: 'tool',
        toolId: ins.toolId,
        toolName: ev?.toolName || 'unknown',
        input: ev?.input,
        output: ev?.output,
        isError: ev?.isError,
      });
    } else {
      segments.push({ type: 'thinking', content: ins.content, summary: ins.summary });
    }
    cursor = offset;
  }

  if (cursor < text.length) {
    segments.push({ type: 'text', content: text.slice(cursor) });
  }

  return segments;
}

export function useStreamingSegments(): MessageSegment[] | null {
  const streamingMessageId = useAerie((s) => s.streamingMessageId);
  const streamingTokens = useAerie((s) => s.streamingTokens);
  const toolOffsets = useAerie((s) => s.toolOffsets);
  const thinkingEvents = useAerie((s) => s.thinkingEvents);
  const toolEvents = useAerie((s) => s.toolEvents);
  return useMemo(
    () => buildStreamingSegments({ streamingMessageId, streamingTokens, toolOffsets, thinkingEvents, toolEvents }),
    [streamingMessageId, streamingTokens, toolOffsets, thinkingEvents, toolEvents],
  );
}
