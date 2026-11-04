// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React, { useRef } from 'react';
import { cn } from '../lib/utils';
import { saveToDevice } from '../lib/download';

// `src` is what gets DRAWN — often a thumbnail, because a bubble is a couple
// of hundred pixels wide. `fullSrc` is the real picture, and it is what a
// hold-to-save and a tap-to-open must both reach for; saving the small copy
// would put the thumbnail in the user's camera roll.
export const LongPressImage = ({ src, fullSrc, alt, className, onLoad, onShortTap, ...props }: any) => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const original = fullSrc ?? src;

  const startPress = () => {
    longPressFiredRef.current = false;
    timerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      if (original) {
        // Ask the server for the file rather than the view. The blob round
        // trip was one thing in the way; the other is that Android's WebView
        // ignores a link's download attribute, so the header is what decides.
        saveToDevice(original);
      }
    }, 500);
  };

  const cancelPress = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    // Suppress the short-tap action if the long-press fired so a download
    // doesn't immediately follow up with a lightbox open.
    if (longPressFiredRef.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (onShortTap && original) {
      e.stopPropagation();
      onShortTap(original);
    }
  };

  return (
    <img
      src={src}
      alt={alt}
      // A hold has to reach us rather than Android's own text-selection and
      // image-drag handling, or the timer never gets to fire.
      className={cn('select-none [-webkit-touch-callout:none]', className)}
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
      onTouchMove={cancelPress}
      onMouseDown={startPress}
      onMouseUp={cancelPress}
      onMouseLeave={cancelPress}
      onClick={handleClick}
      referrerPolicy="no-referrer"
      decoding="async"
      onLoad={onLoad}
      {...props}
    />
  );
};
