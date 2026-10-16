// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '../lib/utils';
import { ThemeConfig } from '../lib/theme';
import { ThemeMode } from '../types';

interface TypingIndicatorProps {
  themeConfig: ThemeConfig;
  themeMode: ThemeMode;
  /** Which corner the companions' tails come from, so the dots match
   *  companion bubbles (the Bubbles switches, lib/bubble-look.ts). */
  tail?: 'top' | 'bottom';
}

export function TypingIndicator({ themeConfig, themeMode, tail = 'top' }: TypingIndicatorProps) {
  const colors = themeConfig[themeMode];
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: reduceMotion ? 0 : 0.2 }}
      className="flex justify-start mb-6"
    >
      <div className={cn(
        "px-5 py-3.5 rounded-[var(--shape-bubble)] border backdrop-blur-md",
        tail === 'bottom' ? "rounded-bl-none" : "rounded-tl-none",
        colors.compBubbleBg,
        colors.compBubbleText,
        colors.panelBorder
      )}>
        <div className="flex gap-1.5 items-center h-5">
          {[0, 1, 2].map((i) => (
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
              style={{ backgroundColor: 'currentColor', opacity: reduceMotion ? 0.7 : undefined }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
