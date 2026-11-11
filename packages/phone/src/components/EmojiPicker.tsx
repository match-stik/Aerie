// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { X, Smile } from 'lucide-react';
import { cn } from '../lib/utils';
import { ThemeConfig } from '../lib/theme';
import { ThemeMode, CustomEmoji, EmojiPack } from '../types';
import { EmojiBrowser } from './EmojiBrowser';

interface EmojiPickerProps {
  // text is what to insert into the composer — a literal Unicode emoji
  // for a standard tab (e.g. "🔥") or a `:shortcode:` for a custom one.
  onSelect: (text: string) => void;
  onClose: () => void;
  themeConfig: ThemeConfig;
  themeMode: ThemeMode;
  customEmojis?: CustomEmoji[];
  emojiPacks?: EmojiPack[];
}

export function EmojiPicker({ onSelect, onClose, themeConfig, themeMode, customEmojis, emojiPacks }: EmojiPickerProps) {
  const colors = themeConfig[themeMode];

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <motion.div
        key="emoji-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[90] bg-black/60"
        onClick={onClose}
      />
      <motion.div
        key="emoji-sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className={cn(
          "fixed bottom-0 left-0 right-0 z-[91] border-t rounded-t-3xl p-3 flex flex-col",
          colors.panelBg,
          colors.panelBorder,
          "backdrop-blur-xl"
        )}
        style={{ maxHeight: '60vh' }}
      >
      {/* Same header as Stickers and GIFs. This tray had none at all — the close
          button lived in the tab strip, so the strip lost width to it and the sheet
          opened with no name on it. */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <Smile size={16} style={{ color: colors.accent }} />
          <h3 className={cn('text-xs font-bold uppercase tracking-widest', colors.accentText)}>Emojis</h3>
        </div>
        <button
          onClick={onClose}
          className={cn(
            'p-1.5 rounded-full transition-colors opacity-60 hover:opacity-100',
            colors.textMuted,
            'hover:bg-black/5 dark:hover:bg-white/5',
          )}
        >
          <X size={14} />
        </button>
      </div>

      {/* The tabs and the grid are the same tray the React plus opens (EmojiBrowser). */}
      <EmojiBrowser
        onSelect={onSelect}
        colors={colors}
        customEmojis={customEmojis}
        emojiPacks={emojiPacks}
      />
      </motion.div>
    </>,
    document.body
  );
}
