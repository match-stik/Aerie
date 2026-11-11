// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A line holding nothing but stickers sits centered in its bubble (theirs, Oct
// 28 2026: 'if it's on its own line with just one sticker ... that the sticker
// is centered?'). Both of the chat's renderers use this, the plain bubble and
// the one for a turn with tool work in it (MessageSegments), because the first
// fix went into only one of them and their screen was showing the other.
import React from 'react';

/**
 * Gives every sticker-only line its own paragraph, so the paragraph renderer
 * can center it. Runs after ::pack_name:: has become ![sticker:...](url).
 * Blank lines add no gap in a bubble, because its paragraphs carry no margin.
 */
export function stickerLinesAsParagraphs(text: string): string {
  if (!text.includes('![sticker:')) return text;
  return text.replace(/(^|\n)[ \t]*((?:!\[sticker:[^\]\n]*\]\([^)\s]*\)[ \t]*)+)(?=\n|$)/g,
    (_m, brk: string, line: string) => `${brk}\n${line.trim()}\n`);
}

/** True when a paragraph's children are sticker pictures and nothing but space. */
export function isStickerOnly(children: React.ReactNode): boolean {
  let stickers = 0;
  for (const part of React.Children.toArray(children)) {
    if (typeof part === 'string') { if (part.trim()) return false; continue; }
    const alt = (part as React.ReactElement<{ alt?: unknown }>).props?.alt;
    if (typeof alt === 'string' && alt.startsWith('sticker:')) { stickers++; continue; }
    return false;
  }
  return stickers > 0;
}
