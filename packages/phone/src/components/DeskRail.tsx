// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React from 'react';
import { Home, LayoutGrid, Lock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAppName, type AppDef } from '../lib/apps';
import { AppLabel } from './AppLabel';

interface DeskRailProps {
  /** Their dock apps, in their order (the same list the home dock draws). */
  apps: AppDef[];
  /** The screen on the stage, so its tile can say so. */
  current: string;
  onOpenApp: (app: AppDef) => void;
  onHome: () => void;
  onOpenDrawer: () => void;
  onLock: () => void;
  /** Unread on the Messages tile; only worth drawing while the conversation is tucked away. */
  messagesBadge?: number;
  /** Their dock switches from Home, so the rail wears what the dock wears. */
  cardBacks: boolean;
  iconCards: boolean;
  accentIcons: boolean;
  /** Bottom stands the rail on its side along the foot of every room (theirs, Nov 15 2026). */
  /** Down the left, or a bar along the bottom or the top. */
  orient?: 'left' | 'bottom' | 'top';
}

// The dock, stood on its end for a wide screen (lib/desk.ts; theirs, Nov 14
// 2026). On the phone the dock lives on the home screen and every room is a
// step away from it; here it stays down the left of every room, so going from
// Notes to the Treehouse is one click and not a trip home. It is built from
// the dock's own pieces (.aerie-dock, its buttons, tiles and labels), so them
// palette, their card switches and their accent icons all reach it untouched.
export function DeskRail({ apps, current, onOpenApp, onHome, onOpenDrawer, onLock, messagesBadge = 0, cardBacks, iconCards, accentIcons, orient = 'left' }: DeskRailProps) {
  const bottom = orient !== 'left';
  const nameOf = useAppName();

  const tile = (key: string, label: string, Icon: LucideIcon, on: boolean, onClick: () => void, badge?: React.ReactNode) => (
    <button
      key={key}
      onClick={onClick}
      // A long name (Screening Room) takes two lines and shrinks a little to
      // fit, as on the phone; the row lines up at the top so its icon stays
      // level with the others (theirs, Nov 15 2026: shoving, then the wide tile
      // made the padding go weird).
      className="aerie-dock-button relative flex w-14 shrink-0 flex-col items-center gap-1"
      data-current={on ? '' : undefined}
      aria-current={on ? 'page' : undefined}
      title={label}
    >
      <div className="aerie-dock-tile flex h-10 w-10 items-center justify-center rounded-xl" data-current={on ? '' : undefined}>
        <Icon className="h-5 w-5" />
      </div>
      {badge}
      <AppLabel basePx={8} minPx={6} className="aerie-dock-label uppercase leading-[1.1] tracking-[0.12em] opacity-80">{label}</AppLabel>
    </button>
  );

  return (
    <nav
      aria-label="Dock"
      className="aerie-desk-rail"
      data-orient={bottom ? orient : undefined}
      data-dock-floating={cardBacks ? undefined : ''}
      data-dock-icon-cards={iconCards ? '' : undefined}
      data-dock-accent-icons={accentIcons ? '' : undefined}
    >
      <div className={bottom ? "aerie-dock flex h-full flex-row items-start justify-center gap-3 overflow-x-auto scrollbar-hide rounded-[var(--shape-surface)] px-4" : "aerie-dock flex h-full flex-col items-center gap-3 overflow-y-auto scrollbar-hide rounded-[var(--shape-surface)] py-4"}>
        {tile('home', 'Home', Home, current === 'home', onHome)}
        {apps.map((app) => tile(
          `dock-${app.id}`,
          nameOf(app),
          app.icon,
          !!app.screen && app.screen === current,
          () => onOpenApp(app),
          app.id === 'messages' && messagesBadge > 0 ? (
            <span
              className="absolute -top-1 right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 px-1 text-[10px] font-bold"
              style={{ background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)', borderColor: 'var(--aerie-surface-strong)' }}
            >
              {messagesBadge}
            </span>
          ) : undefined,
        ))}
        <span className={bottom ? "min-w-2" : "min-h-2 flex-1"} aria-hidden="true" />
        {tile('apps', 'Apps', LayoutGrid, current === 'appdrawer', onOpenDrawer)}
        {tile('lock', 'Lock', Lock, false, onLock)}
      </div>
    </nav>
  );
}
