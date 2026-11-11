// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The table talk, the same in every room that has one (theirs, Nov 4 2026: the
// talk opened differently in Bingo and the Card Room, so one way for all). It
// is always there, its own box under the table, 340px tall, the way the Fleet
// Room's is ('a separate table below like the rest', Oct 28 2026), with no
// button to open it first (theirs, Nov 7 2026: 'can it just be the table on
// there'). The expand button pops it out over the whole screen.
import { MessageCircle, Maximize2, Minimize2 } from 'lucide-react';
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

export function TableTalk({ tableId, colors, expanded, onExpandedChange, base, label, extraBody }: TableTalkProps) {
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
            // and does not go flat (theirs, Nov 7 2026: the fill went away).
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
