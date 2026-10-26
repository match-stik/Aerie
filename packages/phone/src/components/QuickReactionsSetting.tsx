// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Settings, Look & feel: the five reactions at the top of the React tray
// (the owner's ask, Oct 26 2026). Tap a slot, then pick from the same tray the emoji
// picker uses; the next slot is chosen for the owner so the owner can fill all five in a
// row. Custom emojis work too.
import React, { useState } from 'react';
import { cn } from '../lib/utils';
import { ThemeColors } from '../lib/theme';
import { CustomEmoji, EmojiPack } from '../types';
import { EmojiBrowser, ReactionGlyph } from './EmojiBrowser';
import { DEFAULT_QUICK_REACTIONS, QUICK_REACTION_COUNT, quickReactionsOf } from '../lib/quick-reactions';

interface QuickReactionsSettingProps {
  colors: ThemeColors;
  value?: string[];
  customEmojis?: CustomEmoji[];
  emojiPacks?: EmojiPack[];
  onChange: (next: string[]) => void;
}

export function QuickReactionsSetting({ colors, value, customEmojis, emojiPacks, onChange }: QuickReactionsSettingProps) {
  const five = quickReactionsOf(value);
  const [slot, setSlot] = useState<number | null>(null);
  const isDefault = five.every((e, i) => e === DEFAULT_QUICK_REACTIONS[i]);

  function pick(text: string) {
    if (slot === null) return;
    const next = [...five];
    next[slot] = text;
    onChange(next);
    setSlot(slot + 1 < QUICK_REACTION_COUNT ? slot + 1 : null);
  }

  return (
    <section className={cn('space-y-4 p-4 rounded-2xl border', colors.panelBg, colors.panelBorder)}>
      <h3 className={cn('micro-label', colors.accentText)}>Quick Reactions</h3>
      <div className="space-y-3">
        <p className={cn('text-[10px] leading-relaxed', colors.textMuted)}>
          The five at the top of the React tray. Tap one to change it, then pick its replacement below.
        </p>
        <div className="flex items-center justify-around">
          {five.map((emoji, i) => {
            const active = slot === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setSlot(active ? null : i)}
                className={cn(
                  'flex items-center justify-center w-11 h-11 rounded-2xl border text-2xl leading-none transition-all duration-300',
                  active ? 'border-transparent' : cn(colors.panelBorder),
                )}
                style={active ? { background: `${colors.accent}25`, borderColor: colors.accent } : undefined}
                title={active ? 'Pick its replacement below' : 'Change this one'}
              >
                <ReactionGlyph text={emoji} customEmojis={customEmojis} />
              </button>
            );
          })}
        </div>
        {slot !== null && (
          <div className={cn('border-t pt-3', colors.panelBorder)}>
            <EmojiBrowser
              onSelect={pick}
              colors={colors}
              customEmojis={customEmojis}
              emojiPacks={emojiPacks}
            />
          </div>
        )}
        {!isDefault && (
          <button
            type="button"
            onClick={() => { onChange([...DEFAULT_QUICK_REACTIONS]); setSlot(null); }}
            className={cn('text-[10px] uppercase tracking-wider font-bold opacity-70 hover:opacity-100', colors.textMuted)}
          >
            Back to the usual five
          </button>
        )}
      </div>
    </section>
  );
}
