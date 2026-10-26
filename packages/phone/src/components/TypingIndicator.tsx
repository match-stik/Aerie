// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '../lib/utils';
import { ThemeConfig } from '../lib/theme';
import { ThemeMode } from '../types';
import { accentTriad, inkOn } from '../lib/bubble-look';

interface TypingIndicatorProps {
  themeConfig: ThemeConfig;
  themeMode: ThemeMode;
  /** Who is in the room, in house order: one dot each in their own color
   *  Empty keeps the
   *  bubble's ink, as before. */
  companions?: { slug: string; color?: string | null }[];
  /** With no companions passed (Dots on Theme), the dots wear the
   *  theme's accent, fitted to the bubble. */
  accent?: string;
  /** A multi-color palette's own colors, used for the Theme dots in place of
   *  the accent's neighbors. */
  themeColors?: string[];
}

export function TypingIndicator({ themeConfig, themeMode, companions = [], accent, themeColors }: TypingIndicatorProps) {
  const colors = themeConfig[themeMode];
  const reduceMotion = useReducedMotion();
  // Each dot is fitted to the bubble it sits on, read off the page, so a
  // navy dot does not vanish into a dark bubble (lib/bubble-look.ts inkOn).
  const bubbleRef = React.useRef<HTMLDivElement>(null);
  const [under, setUnder] = React.useState<string | null>(null);
  React.useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const m = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g);
    if (m && m.length >= 3) setUnder('#' + m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join(''));
  }, [themeConfig, themeMode]);
  const dots = companions.length > 0
    ? companions.map((c) => inkOn(c.slug, c.color ?? null, themeMode === 'light' ? 'light' : 'dark', under ? [under] : []))
    : accent
      ? (themeColors && themeColors.length >= 3 ? themeColors.slice(0, 3) : accentTriad(accent))
          .map((c) => inkOn('', c, themeMode === 'light' ? 'light' : 'dark', under ? [under] : []))
      : [null, null, null];

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: reduceMotion ? 0 : 0.2 }}
      className="flex justify-start mb-6"
    >
      {/* No tail: a tail points at whoever said something, and while the dots
          are going nobody has yet (the owner's catch, Oct 26 2026). All four corners round. */}
      <div ref={bubbleRef} className={cn(
        "px-5 py-3.5 rounded-[var(--shape-bubble)] border backdrop-blur-md",
        colors.compBubbleBg,
        colors.compBubbleText,
        colors.panelBorder
      )}>
        <div className="flex gap-1.5 items-center h-5">
          {dots.map((dot, i) => (
            <motion.div
              key={i}
              animate={reduceMotion ? {} : {
                y: [0, -6, 0],
                opacity: [0.4, 1, 0.4]
              }}
              transition={reduceMotion ? {} : {
                duration: 0.8,
                repeat: Infinity,
                delay: i * 0.15,
                ease: "easeInOut"
              }}
              className={cn("w-1.5 h-1.5 rounded-full", colors.compBubbleText)}
              style={{ backgroundColor: dot ?? 'currentColor', opacity: reduceMotion ? 0.7 : undefined }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
