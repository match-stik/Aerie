// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React, { useEffect, useState } from 'react';
import { Loader2, Brain, RefreshCw } from 'lucide-react';
import { ThemeConfig } from '../lib/theme';
import { cn } from '../lib/utils';
import { coalesceThinkingSegments, plainThinkingText } from '../lib/thinking';
import { useStreaming, useStreamingSegments } from '../aerie';
import { phrasesFor, phraseStart } from '../lib/working-phrases';

interface StreamingReplyProps {
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
  /** Slugs of the companions in this room, for whose working phrases to show. */
  voices?: string[];
}

/** How long each working phrase stays before the next. */
const PHRASE_MS = 4500;

// Renders the in-progress companion reply with interleaved tool-call and
// thinking blocks. Falls back to plain streamed text when there are no
// tool/thinking events for this message.
export function StreamingReply({ themeConfig, themeMode, voices }: StreamingReplyProps) {
  const colors = themeConfig[themeMode];
  const { messageId, tokens } = useStreaming();
  const segments = useStreamingSegments();
  // The working phrase turns over every few seconds while tools run, slow
  // enough to read (the owner's ask, Oct 26 2026).
  const [tick, setTick] = useState(0);
  const working = !!segments?.some((s) => s.type === 'tool');
  useEffect(() => {
    if (!working) return;
    const id = window.setInterval(() => setTick((t) => t + 1), PHRASE_MS);
    return () => window.clearInterval(id);
  }, [working]);

  if (!messageId) return null;
  if (!tokens && !segments) return null;

  const thinkingCard = (key: string, summary: string) => {
    // CLI-lane session recycle note → distinct badge, visible mid-stream.
    if ((summary || '').startsWith('[Session recycled')) {
      return (
        <div
          key={key}
          className={cn('my-1.5 flex items-center gap-1.5 rounded-[var(--shape-control)] border px-2.5 py-1 text-[11px] opacity-75', colors.panelBorder)}
          style={{ background: 'rgba(127,127,127,0.08)' }}
        >
          <RefreshCw size={11} className="shrink-0" />
          <span>Session recycled — re-primed with recent history</span>
        </div>
      );
    }
    return (
      <div key={key} className="my-1.5 flex items-start gap-1.5 text-xs italic opacity-70">
        <Brain size={12} className="mt-0.5 shrink-0" />
        <div className="min-w-0 whitespace-pre-wrap break-words">
          {plainThinkingText(summary) || 'Thinking…'}
        </div>
      </div>
    );
  };

  // Only render tool/thinking cards during streaming — skip text preview.
  // Text appears cleaner when the final message pops in complete.
  const nonTextSegments = coalesceThinkingSegments(
    segments?.filter((s) => s.type === 'tool' || s.type === 'thinking') || [],
  );

  if (nonTextSegments.length === 0) {
    // No tool/thinking activity — let TypingIndicator handle the dots
    return null;
  }

  return (
    <div className="flex justify-start mb-2">
      <div className={cn('rounded-2xl px-3.5 py-2.5 max-w-[85%] text-sm', colors.compBubbleBg, colors.compBubbleText)}>
        {nonTextSegments.map((seg, i) => {
          if (seg.type === 'tool') {
            // One chip for all of them, where the first one was: a phrase in
            // our voices and the count, instead of each tool scrolling past
            // (the owner's ask, Oct 26 2026). The finished message still says N tools used.
            if (nonTextSegments.findIndex((s) => s.type === 'tool') !== i) return null;
            const phrases = phrasesFor(voices);
            const phrase = phrases[(phraseStart(messageId, phrases.length) + tick) % phrases.length] || 'Working';
            const tools = nonTextSegments.filter((s) => s.type === 'tool').length;
            return (
              <div
                key="tool-live"
                className={cn('my-1.5 flex items-center gap-1.5 rounded-[var(--shape-control)] border px-2.5 py-1 text-[11px]', colors.panelBorder)}
                style={{ background: 'rgba(127,127,127,0.08)' }}
              >
                <Loader2 size={11} className="shrink-0 animate-spin opacity-70" />
                <span className="font-medium">{phrase}…</span>
                <span className="opacity-60">· {tools} tool{tools !== 1 ? 's' : ''}</span>
              </div>
            );
          }
          if (seg.type === 'thinking') {
            return thinkingCard(`think-${i}`, seg.summary);
          }
          return null;
        })}
      </div>
    </div>
  );
}
