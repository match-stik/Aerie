// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { extractThinkingSummary, type ThinkingInsertion } from './agent-segment-builder.js';

interface StreamEventContext {
  currentThinkingAccum: string;
  fullResponseLength: number;
  thinkingBlocks: ThinkingInsertion[];
  broadcastThinking: (content: string, summary: string) => void;
}

export function handleSdkStreamEvent(
  msg: unknown,
  context: StreamEventContext,
): string {
  if (!msg || typeof msg !== 'object' || !('type' in msg)) {
    return context.currentThinkingAccum;
  }

  if ((msg as any).type !== 'stream_event') {
    return context.currentThinkingAccum;
  }

  const streamEvent = (msg as any).event;
  if (streamEvent?.type === 'content_block_start' && streamEvent?.content_block?.type === 'thinking') {
    return '';
  }

  if (streamEvent?.type === 'content_block_delta' && streamEvent?.delta?.type === 'thinking_delta') {
    const thinkingText = streamEvent.delta.thinking || '';
    if (!thinkingText) return context.currentThinkingAccum;
    return context.currentThinkingAccum + thinkingText;
  }

  if (streamEvent?.type === 'content_block_stop' && context.currentThinkingAccum) {
    const summary = extractThinkingSummary(context.currentThinkingAccum);
    context.thinkingBlocks.push({
      textOffset: context.fullResponseLength,
      content: context.currentThinkingAccum,
      summary,
    });
    context.broadcastThinking(context.currentThinkingAccum, summary);
    return '';
  }

  return context.currentThinkingAccum;
}
