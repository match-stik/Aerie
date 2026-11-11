// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// One picture, two shapes: a face is shown in a circle
// everywhere (the chat, home, the call dock) and in a rectangle across the
// top of a contact card, and both croppers save the same picture. So both
// croppers cut the card's own rectangle, with the circle drawn inside it:
// the person cropping sees what the card shows and where the circle falls in one view.
//
// The card's sizes live here and the card reads them, so the cropper's
// rectangle and the card's header cannot drift apart.
import type React from 'react';

/** The card's widest, in rem (what max-w-md was). */
export const CARD_MAX_WIDTH_REM = 28;
/** The picture across the top of the card, in rem (what h-56 was). */
export const CARD_HEADER_REM = 14;
/** The gap either side of the card on a narrow screen, in rem (p-4). */
export const CARD_SIDE_GAP_REM = 1;

/**
 * Width over height of the card's picture at this screen width and root font
 * size, the card being the screen less its gaps up to its widest. A reading
 * it cannot make gives the widest card rather than nothing.
 */
export function contactCardAspect(viewportWidth: number, remPx: number): number {
  const widest = CARD_MAX_WIDTH_REM / CARD_HEADER_REM;
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(remPx) || viewportWidth <= 0 || remPx <= 0) return widest;
  const width = Math.min(CARD_MAX_WIDTH_REM * remPx, viewportWidth - 2 * CARD_SIDE_GAP_REM * remPx);
  if (width <= 0) return widest;
  return width / (CARD_HEADER_REM * remPx);
}

/** The card's aspect on this screen right now. */
export function liveContactCardAspect(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return CARD_MAX_WIDTH_REM / CARD_HEADER_REM;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return contactCardAspect(window.innerWidth, rem);
}

/**
 * Laid over the cropper's rectangle: the circle every face is cut to, which is
 * the middle of the picture, as tall as the card. Clear inside, a thin ring
 * at its edge, and the rest of the rectangle lightly dimmed: still on the
 * card, not in the circle. Outside the rectangle the cropper dims harder.
 */
export function faceGuideStyle(): React.CSSProperties {
  return {
    backgroundImage: 'radial-gradient(circle closest-side at 50% 50%, transparent calc(100% - 2px), rgba(255, 255, 255, 0.9) calc(100% - 2px), rgba(255, 255, 255, 0.9) 100%, rgba(0, 0, 0, 0.32) 100%)',
  };
}

/** What the two guides mean, the same words in both croppers. */
export const FRAME_LEGEND = 'The circle is the face in chat. The whole rectangle is the contact card.';
