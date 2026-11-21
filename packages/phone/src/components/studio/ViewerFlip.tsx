// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React, { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Previous and next for a picture opened big, in Studio's two viewers.
 *
 * The old gallery viewer (GalleryPanel) could swipe and tap between pictures;
 * the gallery that replaced it and the Create page's viewer opened one picture
 * and stopped there. This is that back: an arrow on each
 * side, the arrow keys, and a swipe through ZoomableImage's onSwipe, which only
 * answers while the picture is not zoomed, so panning a zoomed one never flips.
 */
export function useFlip<T extends { id: string }>(list: readonly T[], current: T | null, onShow: (item: T) => void) {
  const index = current ? list.findIndex((item) => item.id === current.id) : -1;
  const prev = index > 0 ? list[index - 1] : null;
  const next = index >= 0 && index < list.length - 1 ? list[index + 1] : null;
  const go = (dir: -1 | 1) => {
    const to = dir < 0 ? prev : next;
    if (to) onShow(to);
  };
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft' && prev) { e.preventDefault(); onShow(prev); }
      if (e.key === 'ArrowRight' && next) { e.preventDefault(); onShow(next); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, prev, next, onShow]);
  return { go, hasPrev: !!prev, hasNext: !!next, position: index >= 0 ? `${index + 1} of ${list.length}` : '' };
}

export function FlipArrows({ hasPrev, hasNext, go }: { hasPrev: boolean; hasNext: boolean; go: (dir: -1 | 1) => void }) {
  const cls = 'absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/65';
  return (
    <>
      {hasPrev && (
        <button type="button" aria-label="Previous picture" onClick={() => go(-1)} className={`${cls} left-2`}>
          <ChevronLeft size={24} />
        </button>
      )}
      {hasNext && (
        <button type="button" aria-label="Next picture" onClick={() => go(1)} className={`${cls} right-2`}>
          <ChevronRight size={24} />
        </button>
      )}
    </>
  );
}
