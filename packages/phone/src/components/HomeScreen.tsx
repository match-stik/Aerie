// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { AppLabel } from './AppLabel';
import React, { useEffect, useRef, useState } from 'react';
import { motion, useIsPresent } from 'motion/react';
import { LayoutGrid, Lock } from 'lucide-react';
import { ThemeConfig } from '../lib/theme';
import { cn, haptic } from '../lib/utils';
import { useBackHandler } from '../lib/use-back-handler';
import { APPS, useAppName, type AppDef } from '../lib/apps';
import type { AppTheme } from '../types';
import { toggleWidget, type HomeWidget, type Layout } from '../lib/home-widgets';
import { noteColorsForAccent, noteColorsForPalette } from '../lib/note-colors';
import { HomeWidgets, QuietLine, WidgetSheet, type WidgetCompanion } from './HomeWidgets';

/** A field that brings the keyboard up. */
/** The tallest the visible screen has been since the app opened: the height with no keyboard up. */
let tallestView = typeof window !== 'undefined' ? (window.visualViewport?.height ?? window.innerHeight) : 0;
if (typeof window !== 'undefined') {
  const note = () => { tallestView = Math.max(tallestView, window.visualViewport?.height ?? window.innerHeight); };
  window.visualViewport?.addEventListener('resize', note);
  window.addEventListener('orientationchange', () => { tallestView = 0; setTimeout(note, 400); });
}

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}

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
  // Their person's widgets and the quiet line (lib/home-widgets.ts).
  widgets: HomeWidget[];
  // Where each one sits, once any has been moved (lib/home-widgets.ts).
  widgetSpots: Layout;
  quietLine: boolean;
  companions: WidgetCompanion[];
  /** Their person's custom emojis, for a status icon on the companions widget. */
  customEmojis?: import('../types').CustomEmoji[];
  stickyNoteColors?: string[];
  /** The Clock widget's look (homeClockLookOf in lib/lock-clock.ts). */
  clockLook?: import('../lib/lock-clock').HomeClockLook;
  spotifyLook?: import('../lib/lock-spotify').LockSpotifyLook;
  weatherLook?: import('../lib/home-widgets').HomeWeatherLook;
  /** The cards behind the widgets, the dock and its tiles (Settings > Home,
   *  Nov 8 2026); off, everything floats on the wallpaper. */
  cardBacks?: boolean;
  /** Cards that wrap what each widget shows instead of filling its spot. */
  cardSnug?: boolean;
  /** The dock's own card (theirs, Nov 8 2026: a switch each for the widgets and the dock). */
  dockCardBacks?: boolean;
  /** With the dock's card off, its icons keep theirs anyway. */
  dockIconCards?: boolean;
  /** The drawer's icon color reaches the dock too, so the two match (theirs, Nov 9 2026). */
  dockAccentIcons?: boolean;
  /** Their own cards, apart from the other widgets'; unset follows the widgets (theirs, Nov 9 2026). */
  companionsCard?: 'card' | 'none';
  quietCard?: 'card' | 'none';
  quietScroll?: boolean;
  onThemeChange: (updates: Partial<AppTheme>) => void;
}

export function HomeScreen({
  onOpenApp,
  onOpenDrawer,
  onLock,
  themeConfig,
  themeMode,
  messagesBadge = 0,
  dockApps,
  widgets,
  widgetSpots,
  quietLine,
  companions,
  customEmojis,
  stickyNoteColors,
  clockLook = 'stacked',
  spotifyLook = 'bar',
  weatherLook = 'card',
  cardBacks = true,
  cardSnug = false,
  dockCardBacks = true,
  dockIconCards = false,
  dockAccentIcons = false,
  companionsCard,
  quietCard,
  quietScroll = false,
  onThemeChange,
}: HomeScreenProps) {
  const colors = themeConfig[themeMode];
  const [pressedAppId, setPressedAppId] = useState<string | null>(null);
  // A long press on the home screen opens the widget sheet, the way a phone's
  // home screen does. Not from inside a text box, where a long press selects,
  // and not on a widget, where a long press picks the widget up to move it.
  const [sheet, setSheet] = useState(false);
  // A box in a widget has the keyboard up; the dock steps aside meanwhile.
  const [typingInWidget, setTypingInWidget] = useState(false);
  // Dropping the keyboard (Android's back, or its own hide key) doesn't blur
  // the box, so the dock stayed hidden until they tapped the screen (theirs,
  // Nov 9 2026). When the keyboard goes away, let go of the box too.
  useEffect(() => {
    if (!typingInWidget) return;
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    // The app's own height can shrink with the keyboard too, so measure
    // against the tallest the screen has been, never the height right now.
    const full = () => Math.max(tallestView, screen.height * 0.6);
    let opened = vv.height < full() - 120;
    const onResize = () => {
      if (vv.height < full() - 120) { opened = true; return; }
      if (!opened) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && isTextField(el)) el.blur();
      setTypingInWidget(false);
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, [typingInWidget]);
  // Back closes the widget sheet rather than putting the whole app away.
  useBackHandler(sheet, () => setSheet(false));
  const holdTimer = useRef<number | null>(null);
  // The dock and the quiet line's real height, so the widgets sit just above them.
  const dockRef = useRef<HTMLDivElement>(null);
  const [dockH, setDockH] = useState(0);
  useEffect(() => {
    const el = dockRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => setDockH(el.offsetHeight));
    watch.observe(el);
    setDockH(el.offsetHeight);
    return () => watch.disconnect();
  }, []);
  const cancelHold = () => { if (holdTimer.current) { window.clearTimeout(holdTimer.current); holdTimer.current = null; } };
  const holdHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      // Holding a widget lifts that widget instead (HomeWidgets.tsx).
      if ((e.target as HTMLElement).closest('input, textarea, [data-widget-cell]')) return;
      cancelHold();
      holdTimer.current = window.setTimeout(() => { haptic(55); setSheet(true); }, 550);
    },
    onPointerUp: cancelHold,
    onPointerMove: (e: React.PointerEvent) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) cancelHold(); },
    onPointerCancel: cancelHold,
    onPointerLeave: cancelHold,
  };
  const openById = (id: string) => { const app = APPS.find((a) => a.id === id); if (app) onOpenApp(app); };
  // Notes wear the theme's own note colors, the way the Notes app paints them.
  const notePalette = React.useMemo(() => {
    if (stickyNoteColors && stickyNoteColors.length) return stickyNoteColors;
    const pal = themeConfig.palette;
    const accent = typeof colors.accent === 'string' ? colors.accent.trim() : '';
    const generated = pal
      ? noteColorsForPalette(themeMode === 'dark' ? pal.night : pal.day, themeMode)
      : accent.startsWith('#') ? noteColorsForAccent(accent, themeMode) : [];
    return generated.length ? generated : ['#FDE68A', '#FBCFE8', '#BFDBFE', '#BBF7D0'];
  }, [stickyNoteColors, themeConfig.palette, colors.accent, themeMode]);
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
      data-home-screen=""
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
      data-home-floating={cardBacks ? undefined : ''}
      data-home-snug={cardBacks && cardSnug ? '' : undefined}
      data-dock-floating={dockCardBacks ? undefined : ''}
      data-dock-icon-cards={dockIconCards ? '' : undefined}
      data-dock-accent-icons={dockAccentIcons ? '' : undefined}
      data-companions-card={companionsCard}
      data-quiet-card={quietCard}
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

      {/* The middle: the widgets, sitting low so the wallpaper keeps the top,
          and the long press that opens the widget sheet. */}
      <div
        // min-h-0: when the widgets reach up past the header (Nov 8 2026) the
        // extra height has to spill upward, not stretch this box and push the
        // bottom row down under the quiet line (their screenshot, 2:41 AM).
        className="flex min-h-0 flex-1 flex-col justify-end px-3"
        // Measured off the dock and the quiet line as they are actually drawn
        // on their phone (theirs, Nov 8 2026: moving widgets down overlapped the
        // quiet line, because a fixed 168 was a guess at their height).
        style={{ paddingBottom: typingInWidget ? 12 : dockH ? dockH + 16 + 12 : quietLine ? 168 : 124 }}
        onFocusCapture={(e) => { if (isTextField(e.target)) setTypingInWidget(true); }}
        onBlurCapture={(e) => { if (isTextField(e.target)) setTypingInWidget(false); }}
        {...holdHandlers}
        onContextMenu={(e) => e.preventDefault()}
      >
        <HomeWidgets
          widgets={widgets}
          spots={widgetSpots}
          companions={companions}
          customEmojis={customEmojis}
          notePalette={notePalette}
          themeMode={themeMode}
          clockLook={clockLook}
          spotifyLook={spotifyLook}
          weatherLook={weatherLook}
          onOpenAppId={openById}
          onPlace={(layout) => onThemeChange({ homeWidgetPlaces: layout })}
        />
      </div>

      {/* Dock — each button gets a fixed width so swapping the theme font
          (sans/serif/mono) can't make the labels widen the row and push
          the dock past the viewport. A long label shrinks to fit its button
          rather than being cut (their catch, Oct 16 2026: MESSAGES and
          TREEHOUSE were losing their ends). */}
      {/* While their person types into a widget the keyboard takes the bottom of the
          screen, and the dock rode up over the box their person was typing in (theirs,
          Oct 26 2026, a screenshot); it steps aside until their person is done. */}
      <div
        ref={dockRef}
        className={cn("absolute bottom-4 left-0 right-0 flex flex-col items-center gap-2 px-3 transition-opacity duration-150", typingInWidget && "pointer-events-none opacity-0")}
        aria-hidden={typingInWidget || undefined}
      >
        {quietLine && (
          <div className="w-full max-w-[380px]">
            <QuietLine companions={companions} scroll={quietScroll} onOpen={() => openById('messages')} />
          </div>
        )}
        <div className="aerie-dock flex w-full justify-around gap-3 rounded-[var(--shape-surface)] px-4 py-3.5 max-w-full overflow-hidden">
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
                    background: 'var(--aerie-selected-fill)',
                    color: 'var(--aerie-on-accent)',
                    borderColor: 'var(--aerie-surface-strong)',
                  }}
                >
                  {messagesBadge}
                </span>
              )}
              <AppLabel basePx={9} className="aerie-dock-label uppercase tracking-[0.12em] opacity-80">{app.name}</AppLabel>
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
            <AppLabel basePx={9} className="aerie-dock-label uppercase tracking-[0.12em] opacity-80">Apps</AppLabel>
          </motion.button>
        </div>
      </div>
      {sheet && (
        <WidgetSheet
          widgets={widgets}
          quietLine={quietLine}
          onToggle={(id) => onThemeChange({ homeWidgets: toggleWidget(widgets, id) })}
          clockLook={clockLook}
          onClockLook={(look) => onThemeChange({ homeClockLook: look })}
          spotifyLook={spotifyLook}
          onSpotifyLook={(look) => onThemeChange({ homeSpotifyLook: look })}
          weatherLook={weatherLook}
          onWeatherLook={(look) => onThemeChange({ homeWeatherLook: look })}
          onQuietLine={(on) => onThemeChange({ homeQuietLine: on })}
          onClose={() => setSheet(false)}
        />
      )}
    </motion.div>
  );
}
