// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { MessageSegment } from '../aerie';
import { plainThinkingText } from './thinking';

// Check if a tool segment should be hidden (internal plumbing)
export function isHiddenTool(seg: MessageSegment & { type: 'tool' }): boolean {
  const inputLower = seg.input?.toLowerCase() || '';
  if (inputLower.includes('outbox')) return true;
  if (inputLower.includes('treehouse')) return true;
  if (inputLower.includes('companion-post')) return true;
  if (seg.toolName === 'Bash') {
    if (/^(write\b|reply|acknowledge|ack\b|final reply|final outbox)/i.test(inputLower)) return true;
    if (/["']detail["']\s*:\s*["'](write\b|reply|acknowledge|ack\b)/i.test(inputLower)) return true;
  }
  return false;
}

/**
 * Whether MessageSegments would draw anything at all for this segment. A voice
 * section made only of things it hides — the Bash call that wrote the reply to
 * the outbox is the usual one — still got a bubble of its own, which drew as
 * an empty pebble above the line.
 */
export function segmentIsVisible(seg: MessageSegment): boolean {
  if (seg.type === 'text') return !!seg.content?.trim();
  if (seg.type === 'tool') return !isHiddenTool(seg);
  if (seg.type === 'thinking') return !!plainThinkingText(seg.content || seg.summary || '');
  return true;
}
