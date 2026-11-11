// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The speaker button for words that are not a bubble: a page of a Story Shelf
// book (theirs, Nov 11 2026: 'need to add read aloud to the tables and story
// shelf'). A table line is a bubble, so it reads from the bubble's own tray
// (RoomBubble hands the tray the line's message id); this is for the rest. A
// tap reads it aloud, a second tap stops it, and the house keeps the audio so
// the second time costs nothing.
import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Square, Volume2 } from 'lucide-react';
import { apiFetch, playVoiceSequence, stopVoicePlayback, unlockVoicePlayback } from '../aerie';
import { cn } from '../lib/utils';

type Loader = (signal: AbortSignal) => Promise<string[]>;

/** A shelf page is not a message; the shelf renders it and hands back one file. */
export function storyPageAloud(bookId: string, pageId: string): Loader {
  return async (signal) => {
    const res = await apiFetch(`/api/story-shelf/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(pageId)}/tts`, { method: 'POST', signal });
    const body = await res.json().catch(() => null) as { url?: unknown; error?: unknown } | null;
    if (!res.ok || !body || typeof body.url !== 'string') throw new Error(typeof body?.error === 'string' ? body.error : 'The read-aloud did not come back');
    return [body.url];
  };
}

export function ReadAloudButton({ load, className, size = 15, label = 'Read aloud' }: { load: Loader; className?: string; size?: number; label?: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => {
    if (controller.current) { controller.current.abort(); stopVoicePlayback(); }
  }, []);

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (controller.current) {
      controller.current.abort();
      stopVoicePlayback();
      controller.current = null;
      setState('idle');
      return;
    }
    const mine = new AbortController();
    controller.current = mine;
    setState('loading');
    // Primed inside the tap, before anything awaits, for a phone that wants a gesture for audio.
    void unlockVoicePlayback().catch(() => {});
    try {
      const urls = await load(mine.signal);
      if (mine.signal.aborted) return;
      setState('playing');
      await playVoiceSequence(urls, mine.signal);
    } catch (error) {
      if (!mine.signal.aborted) console.error('Read aloud failed:', error);
    } finally {
      if (controller.current === mine) controller.current = null;
      setState('idle');
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn('inline-flex items-center justify-center rounded-full p-1 opacity-60 transition-opacity hover:opacity-100', className)}
      style={state === 'playing' ? { color: 'var(--aerie-accent)', opacity: 1 } : { color: 'var(--aerie-text-muted)' }}
      aria-label={state === 'playing' ? 'Stop reading' : label}
      title={state === 'playing' ? 'Stop' : label}
    >
      {state === 'loading' ? <Loader2 size={size} className="animate-spin" /> : state === 'playing' ? <Square size={size - 2} fill="currentColor" /> : <Volume2 size={size} />}
    </button>
  );
}
