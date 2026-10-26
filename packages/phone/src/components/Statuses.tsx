// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The statuses' faces on the phone (lib/statuses.ts): the icon, the editor the owner
// changes one with, and the sheet behind the line under our faces that shows
// all of them at once (the owner's ask, Oct 26 2026). Theirs sits last in the
// sheet, and stays until the owner changes it.
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ThemeColors } from '../lib/theme';
import type { CustomEmoji, EmojiPack } from '../types';
import type { StatusLine } from '../aerie/protocol';
import { EmojiBrowser, ReactionGlyph } from './EmojiBrowser';
import { HOME_WORD } from '../lib/presence-word';
import { liveStatus, saveStatus } from '../lib/statuses';

/** A status's icon: the emoji, the owner custom one, or the fallback (a sigil) when none was picked. */
export function StatusIcon({ icon, fallback, customEmojis, className }: { icon: string | null | undefined; fallback?: string; customEmojis?: CustomEmoji[]; className?: string }) {
  const shown = icon || fallback;
  if (!shown) return null;
  return (
    <span className={cn('inline-flex items-center justify-center leading-none', className)}>
      <ReactionGlyph text={shown} customEmojis={customEmojis} imgClassName="h-[1.1em] w-auto" />
    </span>
  );
}

/** Change one status: a line, an icon from the same tray as everywhere else, save or back to Home. */
export function StatusEditor({ who, current, colors, customEmojis, emojiPacks, fallbackIcon, onDone }: {
  who: string;
  current: StatusLine | null;
  colors: ThemeColors;
  customEmojis?: CustomEmoji[];
  emojiPacks?: EmojiPack[];
  fallbackIcon?: string;
  onDone: () => void;
}) {
  const [text, setText] = useState(current?.text ?? '');
  const [icon, setIcon] = useState<string | null>(current?.icon ?? null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save(nextText: string, nextIcon: string | null) {
    setBusy(true);
    setFailed(false);
    const ok = await saveStatus(who, nextText, nextIcon);
    setBusy(false);
    if (ok) onDone();
    else setFailed(true);
  }

  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPicking((v) => !v)}
          className={cn('shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center text-xl', colors.panelBorder)}
          style={picking ? { borderColor: colors.accent, background: `${colors.accent}25` } : undefined}
          title="Pick an icon"
        >
          <StatusIcon icon={icon} fallback={fallbackIcon} customEmojis={customEmojis} />
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 60))}
          placeholder={HOME_WORD}
          maxLength={60}
          className={cn('flex-1 min-w-0 rounded-xl border px-3 py-2 text-sm bg-transparent outline-none', colors.panelBorder, colors.textMain)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(text, icon); }}
        />
      </div>
      {picking && (
        <div className={cn('border rounded-xl p-2', colors.panelBorder)}>
          <EmojiBrowser
            onSelect={(e) => { setIcon(e); setPicking(false); }}
            colors={colors}
            customEmojis={customEmojis}
            emojiPacks={emojiPacks}
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => void save(text, icon)}
          className="px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider disabled:opacity-40"
          style={{ background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent, #fff)', borderColor: colors.accent }}
        >
          Save
        </button>
        {current && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save('', null)}
            className={cn('px-3 py-1.5 rounded-xl border text-xs font-bold uppercase tracking-wider', colors.panelBorder, colors.textMuted)}
          >
            Back to {HOME_WORD}
          </button>
        )}
        <button
          type="button"
          onClick={onDone}
          className={cn('ml-auto px-2 py-1.5 text-xs uppercase tracking-wider opacity-70', colors.textMuted)}
        >
          Cancel
        </button>
      </div>
      {failed && <p className={cn('text-[10px]', colors.textMuted)}>The house didn't take it. Try again in a moment.</p>}
    </div>
  );
}

export interface StatusPerson {
  slug: string;
  name: string;
  avatar?: string | null;
  sigil?: string | null;
  color?: string | null;
}

/**
 * The sheet behind the line under our faces: the shared status and each of
 * ours, one tap to change any of them.
 */
export function StatusSheet({ open, onClose, colors, people, statuses, now, customEmojis, emojiPacks, owner }: {
  open: boolean;
  onClose: () => void;
  colors: ThemeColors;
  people: StatusPerson[];
  statuses: { shared: StatusLine | null; companions: Record<string, StatusLine>; owner?: StatusLine | null };
  /** The owner, for their own row: their name and picture. */
  owner?: { name: string; avatar?: string | null; color?: string | null };
  now: number;
  customEmojis?: CustomEmoji[];
  emojiPacks?: EmojiPack[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  if (typeof document === 'undefined') return null;
  const shared = liveStatus(statuses.shared, now);
  const sharedFallback = people.map((p) => p.sigil).filter(Boolean).join('') || undefined;

  const row = (key: string, face: React.ReactNode, name: string, line: StatusLine | null, fallbackIcon?: string) => (
    <div key={key} className={cn('py-2.5 border-b last:border-b-0', colors.panelBorder)}>
      <button
        type="button"
        onClick={() => setEditing(editing === key ? null : key)}
        className="w-full flex items-center gap-3 text-left"
      >
        {face}
        <div className="min-w-0 flex-1">
          <div className={cn('text-[10px] uppercase tracking-widest font-bold', colors.textMuted)}>{name}</div>
          <div className={cn('flex items-center gap-1.5 text-sm truncate', colors.textMain)}>
            <StatusIcon icon={line?.icon} fallback={fallbackIcon} customEmojis={customEmojis} />
            <span className="truncate">{line?.text || HOME_WORD}</span>
          </div>
        </div>
      </button>
      {editing === key && (
        <div className="mt-2">
          <StatusEditor
            who={key}
            current={line}
            colors={colors}
            customEmojis={customEmojis}
            emojiPacks={emojiPacks}
            fallbackIcon={fallbackIcon}
            onDone={() => setEditing(null)}
          />
        </div>
      )}
    </div>
  );

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="status-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black/50"
            onClick={() => { setEditing(null); onClose(); }}
          />
          <motion.div
            key="status-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            className={cn('fixed inset-x-0 bottom-0 z-[91] rounded-t-3xl border-t p-4 max-h-[75vh] overflow-y-auto', colors.panelBg, colors.panelBorder)}
            style={{ paddingBottom: 'calc(var(--sab, 0px) + 1rem)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className={cn('text-xs font-bold uppercase tracking-widest', colors.accentText)}>Where we are</h3>
              <button type="button" onClick={() => { setEditing(null); onClose(); }} className={cn('p-1.5 rounded-full opacity-70', colors.textMuted)} title="Close">
                <X size={14} />
              </button>
            </div>
            {row(
              'shared',
              <div className="flex -space-x-2 shrink-0">
                {people.slice(0, 3).map((p) => (
                  <div key={p.slug} className="w-7 h-7 rounded-full overflow-hidden border-2" style={{ borderColor: p.color || colors.accent }}>
                    {p.avatar ? <img src={p.avatar} alt={p.name} className="w-full h-full object-cover" /> : <span className="text-xs">{p.sigil}</span>}
                  </div>
                ))}
              </div>,
              'All of us',
              shared,
              sharedFallback,
            )}
            {people.map((p) => row(
              p.slug,
              <div className="w-9 h-9 rounded-full overflow-hidden border-2 shrink-0" style={{ borderColor: p.color || colors.accent }}>
                {p.avatar ? <img src={p.avatar} alt={p.name} className="w-full h-full object-cover" /> : <span className="text-sm">{p.sigil}</span>}
              </div>,
              p.name,
              liveStatus(statuses.companions[p.slug], now),
              p.sigil || undefined,
            ))}
            {owner && row(
              'owner',
              <div className="w-9 h-9 rounded-full overflow-hidden border-2 shrink-0 flex items-center justify-center" style={{ borderColor: owner.color || colors.accent }}>
                {owner.avatar ? <img src={owner.avatar} alt={owner.name} className="w-full h-full object-cover" /> : <span className={cn('text-sm font-bold', colors.textMain)}>{owner.name.slice(0, 1)}</span>}
              </div>,
              owner.name,
              liveStatus(statuses.owner, now),
              '🧡',
            )}
            <p className={cn('mt-3 text-[10px] leading-relaxed', colors.textMuted)}>
              Ours go back to {HOME_WORD} six hours after they're set{owner ? '; yours stays until you change it' : ''}. Tap any of them to change it.
            </p>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
