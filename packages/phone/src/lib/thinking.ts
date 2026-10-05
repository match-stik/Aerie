// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { MessageSegment } from '../aerie';

const RECYCLE_PREFIX = '[Session recycled';
const CODEX_THOUGHT_PREFIX = '[AERIE_THOUGHT]';

/**
 * Thinking cards already supply their own italic, muted presentation. Strip
 * Markdown's presentation markers so provider summaries such as
 * `**Checking the renderer**` do not leak asterisks into the card title or
 * become a second layer of typography in the expanded body.
 */
export function plainThinkingText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    // Internal routing marker for Codex's authored companion-perspective card.
    // It keeps the segment distinct from spoken commentary but is never UI.
    .replace(/^\s*\[AERIE_THOUGHT\]\s*\n?/i, '')
    .replace(/^```[^\n]*\n?/gm, '')
    .replace(/^```\s*$/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-+]\s+/gm, '• ')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
    .replace(/__([\s\S]*?)__/g, '$1')
    .replace(/~~([\s\S]*?)~~/g, '$1')
    // Single emphasis markers are only removed when they form a pair. This
    // leaves technical text such as *.tsx intact.
    .replace(/(^|[\s([{])\*([^*\n]+)\*(?=$|[\s)\]},.!?:;])/gm, '$1$2')
    .replace(/(^|[\s([{])_([^_\n]+)_(?=$|[\s)\]},.!?:;])/gm, '$1$2')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isAuthoredCodexThought(segment: MessageSegment): boolean {
  return segment.type === 'thinking'
    && (segment.content || '').trimStart().startsWith(CODEX_THOUGHT_PREFIX);
}

function thinkingParts(value: string): string[] {
  return plainThinkingText(value)
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Merge provider phase summaries while preserving their order and wording. */
export function mergeThinkingText(values: string[]): string {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const value of values) {
    for (const part of thinkingParts(value)) {
      const key = part.replace(/\s+/g, ' ').toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(part);
    }
  }

  return merged.join('\n\n');
}

export function thinkingTitle(value: string): string {
  const firstPart = thinkingParts(value)[0] || 'Thinking…';
  const oneLine = firstPart.replace(/\s+/g, ' ');
  return oneLine.length > 100 ? `${oneLine.slice(0, 97)}...` : oneLine;
}

function isRecycleThinking(segment: MessageSegment): boolean {
  return segment.type === 'thinking'
    && (segment.content || segment.summary || '').startsWith(RECYCLE_PREFIX);
}

/**
 * Codex can expose the same reasoning as individual commentary phases and as
 * grouped provider summaries. Present those as one thought card, like the
 * Claude lane, while leaving session-recycle seams independent.
 */
export function coalesceThinkingSegments(segments: MessageSegment[]): MessageSegment[] {
  const coalesceRun = (run: MessageSegment[]): MessageSegment[] => {
    const authoredValues = run
      .filter(isAuthoredCodexThought)
      .map((segment) => segment.type === 'thinking' ? (segment.content || segment.summary) : '');
    // If a transition build ever persisted both provider telemetry and the new
    // authored card, the authored perspective wins. Never blend engineering
    // labels back into the companion's voice.
    const authoredWins = authoredValues.length > 0;
    const values = (authoredWins ? run.filter(isAuthoredCodexThought) : run)
      .filter((segment) => segment.type === 'thinking' && !isRecycleThinking(segment))
      .map((segment) => segment.type === 'thinking' ? (segment.content || segment.summary) : '');
    if (values.length === 0) return run;

    const content = mergeThinkingText(values);
    // An authored-thought field that arrives empty — or a card whose whole body
    // is the routing marker and nothing else — has no thought in it to open.
    // Dropping it here is the difference between "they said nothing this turn"
    // and a card that says Thinking… and does nothing when it is tapped.
    if (!content) {
      return run.filter((segment) => segment.type !== 'thinking' || isRecycleThinking(segment));
    }
    const merged: MessageSegment = {
      type: 'thinking',
      content,
      summary: thinkingTitle(content),
    };
    let inserted = false;
    return run.flatMap((segment) => {
      if (segment.type !== 'thinking' || isRecycleThinking(segment)) return [segment];
      if (authoredWins && !isAuthoredCodexThought(segment)) return [];
      if (inserted) return [];
      inserted = true;
      return [merged];
    });
  };

  // Spoken text is a hard boundary. Consolidate the provider's little phase
  // labels on each side, but never pull later thinking above words the
  // companion said mid-turn. Tool calls are transparent within a thought run.
  const output: MessageSegment[] = [];
  let run: MessageSegment[] = [];
  const flush = () => {
    if (run.length > 0) output.push(...coalesceRun(run));
    run = [];
  };

  for (const segment of segments) {
    const boundary = isRecycleThinking(segment)
      || segment.type === 'sticker'
      || segment.type === 'emoji'
      || (segment.type === 'text' && !!segment.content.trim());
    if (boundary) {
      flush();
      output.push(segment);
    } else {
      run.push(segment);
    }
  }
  flush();
  return output;
}
