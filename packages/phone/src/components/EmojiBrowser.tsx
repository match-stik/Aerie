// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The one emoji tray: custom packs first, then the standard sections, a tab
// each, and the grid for whichever tab is open. The chat-input picker, the
// React tray's plus and the owner quick-reaction picker in Settings all use this,
// so all three hold the same emoji in the same order (the owner's ask, Oct 26 2026).
import React, { useMemo, useState } from 'react';
import { Sparkles, Inbox } from 'lucide-react';
import { cn } from '../lib/utils';
import { ThemeColors } from '../lib/theme';
import { CustomEmoji, EmojiPack } from '../types';
import { EMOJI_SECTIONS } from '../lib/emoji';
import { drawable } from '../lib/emoji-support';

// Tab id encoding: 'pack:<id>' for a custom pack, 'loose' for emojis with
// no pack_id, and the section's label for a standard section.
type TabId = string;

// One representative emoji per standard section, so the strip reads without text.
const SECTION_ICON: Record<string, string> = {
  'Smileys & Emotion': '😀',
  'People & Body': '👋',
  'Animals & Nature': '🐱',
  'Food & Drink': '🍕',
  'Activities': '⚽',
  'Travel & Places': '✈️',
  'Objects': '💡',
  'Symbols': '🔣',
  'Flags': '🏳️',
};

interface EmojiBrowserProps {
  // A literal Unicode emoji for a standard tab, or `:shortcode:` for a custom one.
  onSelect: (text: string) => void;
  colors: ThemeColors;
  customEmojis?: CustomEmoji[];
  emojiPacks?: EmojiPack[];
  /** How tall the grid may grow before it scrolls. */
  gridClassName?: string;
}

export function EmojiBrowser({ onSelect, colors, customEmojis, emojiPacks, gridClassName = 'max-h-44' }: EmojiBrowserProps) {
  // Custom emojis grouped by pack, each pack its own tab; ones with no pack
  // fall into an Unpacked tab when there are any.
  const { packBuckets, looseBucket } = useMemo(() => {
    const buckets = new Map<string, CustomEmoji[]>();
    const loose: CustomEmoji[] = [];
    for (const e of customEmojis ?? []) {
      if (e.pack_id) {
        if (!buckets.has(e.pack_id)) buckets.set(e.pack_id, []);
        buckets.get(e.pack_id)!.push(e);
      } else {
        loose.push(e);
      }
    }
    return { packBuckets: buckets, looseBucket: loose };
  }, [customEmojis]);

  const orderedPacks = useMemo(
    () => (emojiPacks ?? []).filter((p) => packBuckets.has(p.id)),
    [emojiPacks, packBuckets],
  );
  // A pack missing from the packs list (not loaded yet, or the list was never
  // passed) still gets a tab, so no custom emoji is ever unreachable.
  const unlistedPackIds = useMemo(
    () => [...packBuckets.keys()].filter((id) => !orderedPacks.some((p) => p.id === id)),
    [packBuckets, orderedPacks],
  );
  const hasLoose = looseBucket.length > 0;
  const defaultTab: TabId =
    orderedPacks[0] ? `pack:${orderedPacks[0].id}` :
    unlistedPackIds[0] ? `pack:${unlistedPackIds[0]}` :
    hasLoose ? 'loose' :
    EMOJI_SECTIONS[0].label;
  const [tab, setTab] = useState<TabId>(defaultTab);

  const activeSection =
    tab.startsWith('pack:') || tab === 'loose'
      ? null
      : EMOJI_SECTIONS.find((s) => s.label === tab) ?? null;
  // Only the open section is measured, and each emoji only once per phone.
  const sectionEmojis = useMemo(() => (activeSection ? drawable(activeSection.emojis) : []), [activeSection]);
  const activePackId = tab.startsWith('pack:') ? tab.slice(5) : null;
  const activePackName =
    activePackId ? (emojiPacks?.find((p) => p.id === activePackId)?.name ?? 'Pack') : null;
  const activeCustomEmojis: CustomEmoji[] | null =
    activePackId ? packBuckets.get(activePackId) ?? [] :
    tab === 'loose' ? looseBucket :
    null;

  function packIcon(packId: string, name: string) {
    const first = packBuckets.get(packId)?.[0];
    if (!first) return <Sparkles size={14} />;
    return (
      <img
        src={first.url}
        alt={name}
        className="h-[1.2em] w-auto object-contain"
        referrerPolicy="no-referrer"
      />
    );
  }

  function tabButton(id: TabId, content: React.ReactNode, title: string) {
    const isActive = tab === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => setTab(id)}
        className={cn(
          'shrink-0 flex items-center justify-center w-7 h-7 rounded-full text-base leading-none transition-colors',
          // The Unpacked icon and the bullet fallback draw in currentColor.
          colors.textMain,
          isActive ? '' : 'opacity-60 hover:opacity-100',
        )}
        style={isActive ? { background: `${colors.accent}25` } : undefined}
        title={title}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex flex-col min-h-0">
      {/* Horizontally scrollable, so any number of packs fits. */}
      <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide mb-2">
        {orderedPacks.map((p) => tabButton(`pack:${p.id}`, packIcon(p.id, p.name), p.name))}
        {unlistedPackIds.map((id) => tabButton(`pack:${id}`, packIcon(id, 'Pack'), 'Pack'))}
        {hasLoose && tabButton('loose', <Inbox size={14} />, 'Unpacked')}
        {EMOJI_SECTIONS.map((section) =>
          tabButton(section.label, SECTION_ICON[section.label] ?? '•', section.label),
        )}
      </div>

      <div className={cn('text-[9px] font-bold uppercase tracking-widest mb-2 px-1 truncate', colors.textMuted)}>
        {activePackName ?? (tab === 'loose' ? 'Unpacked' : tab)}
      </div>

      <div className={cn('overflow-y-auto pr-1 scrollbar-hide', gridClassName)}>
        {activeCustomEmojis ? (
          activeCustomEmojis.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 opacity-40 text-center">
              <Sparkles size={24} className="mb-1.5" />
              <p className="text-[10px] uppercase font-bold tracking-tighter">Empty</p>
              <p className="text-[10px] mt-0.5 italic">Add emojis in the Packs app</p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5 px-0.5 py-1">
              {activeCustomEmojis.map((emoji) => (
                <button
                  key={emoji.id}
                  type="button"
                  onClick={() => onSelect(`:${emoji.shortcode}:`)}
                  className="p-0.5 flex items-center justify-center transition-all duration-300 hover:scale-125 active:scale-95"
                  title={`:${emoji.shortcode}:`}
                >
                  <img
                    src={emoji.url}
                    alt={emoji.shortcode}
                    className="h-[1.4em] w-auto object-contain rounded-sm"
                    referrerPolicy="no-referrer"
                  />
                </button>
              ))}
            </div>
          )
        ) : (
          activeSection && (
            <div className="grid grid-cols-8 gap-0.5">
              {sectionEmojis.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onSelect(emoji)}
                  className="text-xl p-1 rounded transition-transform hover:scale-125 active:scale-95"
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

/** A reaction as the owner sees it: the emoji itself, or a custom one's picture. */
export function ReactionGlyph({ text, customEmojis, imgClassName = 'h-7 w-auto' }: { text: string; customEmojis?: CustomEmoji[]; imgClassName?: string }) {
  const m = /^:([\w-]+):$/.exec(text);
  const custom = m ? customEmojis?.find((e) => e.shortcode === m[1]) : undefined;
  if (custom) {
    return (
      <img
        src={custom.url}
        alt={custom.shortcode}
        className={cn('object-contain rounded-sm', imgClassName)}
        referrerPolicy="no-referrer"
      />
    );
  }
  return <>{text}</>;
}
