// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The table talk, the same in every room that has one. It
// is always there, its own box under the table, 340px tall, the way the Fleet
// Room's is ('a separate table below like the rest', Oct 28 2026), with no
// button to open it first. The expand button pops it out over the whole screen.
// On the laptop it lives in the conversation's column instead (lib/side-table.ts).
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, Maximize2, Minimize2, MessagesSquare } from 'lucide-react';
import { sideTable, useSideTable } from '../../lib/side-table';
import { CardRail } from './CardRail';
import { useBackHandler } from '../../lib/use-back-handler';
import { cn } from '../../lib/utils';
import type { ThemeConfig } from '../../lib/theme';

export interface TableTalkProps {
  tableId: string | null;
  colors: ThemeConfig['light'];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** The rail's own endpoints, for a room whose talk is not the Card Room's. */
  base?: string;
  label?: string;
  extraBody?: () => Record<string, unknown>;
}

export function TableTalk(props: TableTalkProps) {
  const side = useSideTable();
  return side.desk ? <ColumnTalk {...props} slot={side.slot} hidden={side.showChat} /> : <PhoneTalk {...props} />;
}

/**
 * The laptop: the talk fills the conversation's column for as long as the
 * room is open, with a button back to the conversation (and the conversation
 * has one back here). Hidden rather than unmounted while the chat shows, so
 * the rail keeps its place.
 */
function ColumnTalk({ tableId, colors, base, label, extraBody, slot, hidden }: TableTalkProps & { slot: HTMLElement | null; hidden: boolean }) {
  useEffect(() => sideTable.enter(), []);
  if (!slot) return null;
  return createPortal(
    <section
      className={cn('absolute inset-0 flex flex-col', hidden ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100')}
      // The frame's own black (white in Daylight), the color the conversation's
      // header is painted, so the column reads the same whichever is in it.
      style={{ backgroundColor: 'var(--aerie-header, #000)' }}
      aria-hidden={hidden || undefined}
    >
      <div className={cn('flex items-center justify-between border-b px-3 py-2', colors.panelBorder)} style={{ paddingTop: 'calc(var(--sat, 0px) + 8px)' }}>
        <div className="flex items-center gap-2">
          <MessageCircle size={15} style={{ color: colors.accent }} />
          <span className="text-[13px] font-semibold uppercase tracking-[.14em]">The table talk</span>
        </div>
        <button
          type="button"
          onClick={() => sideTable.showChat(true)}
          className={cn('flex items-center gap-1.5 rounded-[var(--shape-chip)] border px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[.12em] transition active:scale-95', colors.panelBorder)}
          aria-label="Back to the conversation"
        >
          <MessagesSquare size={14} /> Back to chat
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <CardRail tableId={tableId} colors={colors} base={base} label={label} extraBody={extraBody} />
      </div>
    </section>,
    slot,
  );
}

/** The phone, as it was: a box under the table that pops out over the screen. */
function PhoneTalk({ tableId, colors, expanded, onExpandedChange, base, label, extraBody }: TableTalkProps) {
  // Back folds a popped-out talk back under the table before it leaves the room.
  useBackHandler(expanded, () => onExpandedChange(false));
  return (
    <>
      {expanded && <div className="fixed inset-0 z-[99]" style={{ backgroundColor: 'rgba(0,0,0,.72)' }} aria-hidden="true" />}
      {expanded && <div className="h-[400px] shrink-0" aria-hidden="true" />}
      {(
        <section
          className={cn(
            'flex flex-col border shadow-[0_24px_70px_rgba(0,0,0,.48)]',
            expanded
              ? 'fixed inset-x-4 bottom-[max(12px,env(safe-area-inset-bottom))] top-[calc(env(safe-area-inset-top)+68px)] z-[100] rounded-[calc(28px*var(--shape-scale,1))]'
              : 'mx-2 mb-2 h-[400px] shrink-0 rounded-[var(--shape-surface)]',
            // Popped out it keeps the panel's own paint (the palette's wash
            // rides this class) over a solid base, so it is not see-through
            // and does not go flat.
            colors.panelBg, colors.panelBorder,
          )}
          style={expanded ? { backgroundColor: 'var(--custom-panelBg, var(--aerie-surface-strong))' } : undefined}
        >
          <div className={cn('flex items-center justify-between border-b px-3 py-2', colors.panelBorder)}>
            <div className="flex items-center gap-2">
              <MessageCircle size={15} style={{ color: colors.accent }} />
              <span className="text-[13px] font-semibold uppercase tracking-[.14em]">The table talk</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onExpandedChange(!expanded)}
                className={cn('flex h-9 w-9 items-center justify-center rounded-[var(--shape-chip)] border transition active:scale-95', colors.panelBorder)}
                aria-label={expanded ? 'Collapse the table talk' : 'Expand the table talk'}
              >
                {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <CardRail tableId={tableId} colors={colors} base={base} label={label} extraBody={extraBody} />
          </div>
        </section>
      )}
    </>
  );
}
