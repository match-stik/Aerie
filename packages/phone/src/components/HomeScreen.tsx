// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import React, { useState } from 'react';
import { motion, useIsPresent } from 'motion/react';
import { LayoutGrid, Lock } from 'lucide-react';
import { ThemeConfig } from '../lib/theme';
import { cn, haptic } from '../lib/utils';
import { type AppDef } from '../lib/apps';

interface HomeScreenProps {
  onOpenApp: (app: AppDef) => void;
  onOpenDrawer: () => void;
  onLock: () => void;
  wallpaper?: string;
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
  messagesBadge?: number;
  // Resolved AppDef list to show on the dock. App.tsx maps the user's
  // saved dockAppIds against the registry and passes the result here.
  dockApps: AppDef[];
}

export function HomeScreen({
  onOpenApp,
  onOpenDrawer,
  onLock,
  themeConfig,
  themeMode,
  messagesBadge = 0,
  dockApps,
}: HomeScreenProps) {
  const colors = themeConfig[themeMode];
  const [pressedAppId, setPressedAppId] = useState<string | null>(null);
  // False for the whole of the exit animation, while this is still mounted.
  const present = useIsPresent();

  // Press-and-hold shows the tile's accent glow for as long as the finger
  // stays down; the app opens on RELEASE. Click can't do this — Android
  // suppresses the click event after a long-press, which showed the glow
  // and then never opened the app. Pointer events fire regardless of hold
  // duration; sliding off the tile cancels instead of opening.
  const pressHandlers = (id: string, action: () => void) => ({
    // Press tick comes from the global button listener in App.tsx.
    onPointerDown: () => setPressedAppId(id),
    onPointerUp: () => {
      setPressedAppId((current) => {
        if (current === id) {
          haptic(55); // firmer pulse as the app opens
          window.setTimeout(action, 90);
        }
        return current;
      });
    },
    onPointerLeave: () => setPressedAppId((current) => (current === id ? null : current)),
    onPointerCancel: () => setPressedAppId((current) => (current === id ? null : current)),
    // Android long-press otherwise opens the context menu mid-hold.
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  return (
    <motion.div
      className={cn('absolute inset-0 z-40 flex flex-col overflow-hidden', colors.textMain)}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05, transition: { duration: 0.3 } }}
      // On the way out this stays mounted for the length of its fade, at z-40,
      // over a Messages app that lives at z-10 and is already fully painted and
      // tappable. Without this, a tap into the chat input during those 300ms
      // lands on whichever icon happens to sit at those coordinates and opens
      // that app instead. Leaving means leaving: stop taking taps immediately.
      style={{ pointerEvents: present ? undefined : 'none' }}
    >
      {/* Header */}
      <div
        className="z-10 flex w-full items-center justify-end px-6 py-6 gap-3"
        style={{ paddingTop: 'calc(var(--sat) + 1.5rem)' }}
      >
        <button
          onClick={onLock}
          className={cn('aerie-glass-button p-2 rounded-full opacity-80 hover:opacity-100', colors.textMain)}
          title="Lock Screen"
        >
          <Lock size={18} strokeWidth={1.5} />
        </button>
      </div>

      {/* App Grid */}
      <div className="flex-1 px-8 pt-8" />

      {/* Dock — each button gets a fixed width so swapping the theme font
          (sans/serif/mono) can't make the labels widen the row and push
          the dock past the viewport. Long labels truncate; the icon is
          the primary affordance. */}
      <div className="absolute bottom-4 left-0 right-0 flex justify-center px-4">
        <div className="aerie-dock flex gap-3 rounded-[1.7rem] px-4 py-3.5 max-w-full overflow-hidden">
          {dockApps.map((app) => (
            <motion.button
              key={`dock-${app.id}`}
              whileHover={{ y: -2 }}
              {...pressHandlers(app.id, () => onOpenApp(app))}
              className="aerie-dock-button relative flex w-14 flex-col items-center gap-1.5"
              data-pressed={pressedAppId === app.id}
              aria-pressed={pressedAppId === app.id}
            >
              <div
                className="aerie-dock-tile flex h-12 w-12 items-center justify-center rounded-xl"
                data-pressed={pressedAppId === app.id}
              >
                <app.icon className="h-6 w-6" />
              </div>
              {app.id === 'messages' && messagesBadge > 0 && (
                <span
                  className="absolute -top-1 right-1 min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1 border-2"
                  style={{
                    backgroundColor: colors.accent,
                    color: '#090807',
                    borderColor: 'var(--aerie-surface-strong)',
                  }}
                >
                  {messagesBadge}
                </span>
              )}
              <span className="aerie-dock-label w-full truncate text-center text-[9px] font-medium tracking-[0.12em] uppercase opacity-80">{app.name}</span>
            </motion.button>
          ))}

          {/* App drawer launcher */}
          <motion.button
            whileHover={{ y: -2 }}
            {...pressHandlers('apps', onOpenDrawer)}
            className="aerie-dock-button flex w-14 flex-col items-center gap-1.5"
            data-pressed={pressedAppId === 'apps'}
            aria-pressed={pressedAppId === 'apps'}
          >
            <div
              className="aerie-dock-tile flex h-12 w-12 items-center justify-center rounded-xl"
              data-pressed={pressedAppId === 'apps'}
            >
              <LayoutGrid className="h-6 w-6" />
            </div>
            <span className="aerie-dock-label w-full truncate text-center text-[9px] font-medium tracking-[0.12em] uppercase opacity-80">Apps</span>
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
