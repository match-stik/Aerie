// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React from "react";
import { Image as ImageIcon, Upload } from "lucide-react";
import { APPS } from "../../lib/apps";
import { cn } from "../../lib/utils";
import { LockPreview } from "../LockClock";
import { lockSpotifyLookOf, lockSpotifyOf, type LockSpotifyLook } from "../../lib/lock-spotify";
import { lockCardBacksOf, lockCardsOf, type LockCardChoice } from "../../lib/lock-cards";
import { lockClockAtOf, lockFaceOf, lockHiddenOf, lockPositionOf, lockShortcutsOf, lockShowOf, lockSizeOf, lockWeatherAtOf, withHidden, lockWeatherLookOf, type LockFace, type LockPiece, type LockShow, type LockSize, type LockWeatherLook } from "../../lib/lock-clock";
import type { SettingsState } from './use-settings-state';

export function LockPane({ s }: { s: SettingsState }) {
  const { colors, lockCorner, setLockCorner, nameOf, handleImageUpload, theme, onThemeChange } = s;
  return (
    <>
    {(() => {
      const face = lockFaceOf(theme.lockFace);
      const position = lockPositionOf(theme.lockClockPosition);
      const size = lockSizeOf(theme.lockClockSize);
      const wallpaper = theme.lockScreenWallpaper || theme.wallpaper;
      // Set once this face's clock, or the weather, has been dragged
      // somewhere by hand.
      const movedAt = lockClockAtOf(theme.lockClockAt, face);
      const weatherMoved = lockWeatherAtOf(theme.lockWeatherAt);
      const placed = !!theme.lockSpots && Object.keys(theme.lockSpots).length > 0;
      const weatherLook = lockWeatherLookOf(theme.lockWeatherLook);
      // What has been tucked away; its chip brings it back.
      const hidden = lockHiddenOf(theme.lockHidden);
      const chip = (on: boolean) => cn(
        "flex items-center justify-center px-3 py-2.5 rounded-2xl border text-[11px] font-bold uppercase tracking-widest transition-all duration-300",
        on ? "border-transparent" : `${colors.panelBg} ${colors.panelBorder} ${colors.accentText} hover:opacity-80`,
      );
      const chipStyle = (on: boolean) => on ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' } : undefined;
      const FACES: { id: LockFace; label: string; hint: string }[] = [
        { id: "stacked", label: "Stacked", hint: "Hour over minute, big" },
        { id: "dateline", label: "Dateline", hint: "Your picture up top, time along the bottom" },
        { id: "classic", label: "Classic", hint: "Today's clock, moved and sized your way" },
        { id: "serif", label: "Serif", hint: "The time in a book face, the day in italics" },
        { id: "outline", label: "Outline", hint: "The hour solid, the minutes drawn in outline" },
        { id: "analog", label: "Analog", hint: "A dial with hands" },
        { id: "script", label: "Script", hint: "The time in handwriting" },
        { id: "words", label: "Words", hint: "The time written out" },
        { id: "ring", label: "Ring", hint: "The hour in a circle that fills as it goes" },
      ];
      return (<>
        <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
          <h3 className={cn("micro-label", colors.accentText)}>Wallpaper</h3>
          {/* Its own picture, which falls back to the home wallpaper when unset. */}
          <div className="flex gap-6 items-center">
            <div
              className={cn(
                "w-24 h-32 shrink-0 rounded-[calc(24px*var(--shape-scale,1))] border-2 border-dashed flex items-center justify-center overflow-hidden relative group transition-all duration-500",
                colors.panelBg,
                colors.panelBorder,
                "hover:border-opacity-50",
              )}
            >
              <label className="absolute inset-0 cursor-pointer z-10">
                <input
                  type="file"
                  onChange={(e) => handleImageUpload(e, "lockscreen")}
                  className="hidden"
                  accept="image/*"
                />
              </label>
              {theme.lockScreenWallpaper ? (
                <>
                  <img
                    src={theme.lockScreenWallpaper}
                    className="w-full h-full object-cover opacity-60"
                    alt="Lock Screen Wallpaper"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Upload size={24} className="text-white" />
                  </div>
                </>
              ) : (
                <ImageIcon
                  size={28}
                  className={colors.textMuted}
                  strokeWidth={1.5}
                />
              )}
            </div>
            <div className="flex-1 space-y-3">
              <p
                className={cn(
                  "text-xs leading-relaxed font-medium text-left",
                  colors.textMuted,
                )}
              >
                Lock Screen Background
              </p>
              {theme.lockScreenWallpaper && (
                <button
                  onClick={() =>
                    onThemeChange({ lockScreenWallpaper: undefined })
                  }
                  className="text-[10px] font-bold uppercase tracking-widest transition-colors opacity-80 hover:opacity-100"
                  style={{ color: colors.accent }}
                >
                  Reset Lock Screen
                </button>
              )}
            </div>
          </div>
        </section>
        {/* The clock and everything about it in one place (theirs, Nov 8 2026:
            the sizes sat apart from the faces, mixed in with other things). */}
        <section className={cn("space-y-4 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
          <h3 className={cn("micro-label", colors.accentText)}>Clock</h3>
          <div className="grid grid-cols-3 gap-3">
            {FACES.map((f) => (
              <button
                key={f.id}
                onClick={() => onThemeChange({ lockFace: f.id })}
                className="flex flex-col items-center gap-2 text-center"
                aria-pressed={face === f.id}
              >
                <span
                  className="rounded-[18px] p-[3px]"
                  style={{ background: face === f.id ? 'var(--aerie-selected-fill)' : 'transparent' }}
                >
                  <LockPreview face={f.id} position={position} size={size} wallpaper={wallpaper} width={88} at={lockClockAtOf(theme.lockClockAt, f.id)} />
                </span>
                <span className={chip(face === f.id)} style={chipStyle(face === f.id)}>{f.label}</span>
                <span className={cn("text-[10px] leading-snug", colors.textMuted)}>{f.hint}</span>
              </button>
            ))}
          </div>
          <h3 className={cn("micro-label pt-1", colors.accentText)}>Size</h3>
          <div className="grid grid-cols-5 gap-1.5">
            {([["xs", "XS"], ["s", "S"], ["m", "M"], ["l", "L"], ["xl", "XL"]] as [LockSize, string][]).map(([id, label]) => (
              <button key={id} onClick={() => onThemeChange({ lockClockSize: id })} className={chip(size === id)} style={chipStyle(size === id)}>
                {label}
              </button>
            ))}
          </div>
          <h3 className={cn("micro-label pt-1", colors.accentText)}>On the lock screen</h3>
          <div className="grid grid-cols-2 gap-2">
            {([[true, "Show"], [false, "Hide"]] as [boolean, string][]).map(([on, label]) => (
              <button key={label} onClick={() => onThemeChange({ lockHidden: withHidden(theme.lockHidden, "clock", on) })} className={chip(!hidden.has("clock") === on)} style={chipStyle(!hidden.has("clock") === on)} aria-pressed={!hidden.has("clock") === on}>
                {label}
              </button>
            ))}
          </div>
        </section>
        <section className={cn("space-y-3 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
          <h3 className={cn("micro-label", colors.accentText)}>Weather</h3>
          <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
            Its look on the lock screen. Weather comes from where your phone is.
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {([["pill", "Pill"], ["line", "Line"], ["big", "Big"], ["card", "Card"]] as [LockWeatherLook, string][]).map(([id, label]) => (
              <button key={id} onClick={() => onThemeChange({ lockWeatherLook: id })} className={chip(weatherLook === id)} style={chipStyle(weatherLook === id)}>
                {label}
              </button>
            ))}
          </div>
          <h3 className={cn("micro-label pt-1", colors.accentText)}>On the lock screen</h3>
          <div className="grid grid-cols-2 gap-2">
            {([[true, "Show"], [false, "Hide"]] as [boolean, string][]).map(([on, label]) => (
              <button key={label} onClick={() => onThemeChange({ lockHidden: withHidden(theme.lockHidden, "weather", on) })} className={chip(!hidden.has("weather") === on)} style={chipStyle(!hidden.has("weather") === on)} aria-pressed={!hidden.has("weather") === on}>
                {label}
              </button>
            ))}
          </div>
        </section>
        {/* Every card on the lock screen, together: what each one shows, then
            how they all look (theirs, Nov 8 2026). */}
        <section className={cn("space-y-3 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
          <h3 className={cn("micro-label", colors.accentText)}>Cards</h3>
          <h3 className={cn("micro-label pt-1", colors.accentText)}>Who's written you</h3>
          <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
            A card on the lock screen when there's something new. Names keeps the words off it, for when your phone is face up at work.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {([["names", "Names"], ["first-line", "First line"], ["nothing", "Nothing"]] as [LockShow, string][]).map(([id, label]) => (
              <button key={id} onClick={() => onThemeChange({ lockShow: id })} className={chip(lockShowOf(theme.lockShow) === id)} style={chipStyle(lockShowOf(theme.lockShow) === id)}>
                {label}
              </button>
            ))}
          </div>
          <h3 className={cn("micro-label pt-1", colors.accentText)}>Spotify</h3>
          <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
            A card on the lock screen while a song is playing or paused: its cover, the song and the artist, with previous, play or pause, and next. Tap the cover to open Spotify.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {([[true, "On"], [false, "Off"]] as [boolean, string][]).map(([on, label]) => (
              <button key={label} onClick={() => onThemeChange({ lockSpotify: on })} className={chip(lockSpotifyOf(theme.lockSpotify) === on)} style={chipStyle(lockSpotifyOf(theme.lockSpotify) === on)} aria-pressed={lockSpotifyOf(theme.lockSpotify) === on}>
                {label}
              </button>
            ))}
          </div>
          {/* Its look (theirs, Nov 7 2026: more looks for the player). */}
          <div className="grid grid-cols-3 gap-2">
            {([["bar", "Bar"], ["cover", "Record"], ["slim", "Slim"]] as [LockSpotifyLook, string][]).map(([id, label]) => (
              <button key={id} onClick={() => onThemeChange({ lockSpotifyLook: id })} className={chip(lockSpotifyLookOf(theme.lockSpotifyLook) === id)} style={chipStyle(lockSpotifyLookOf(theme.lockSpotifyLook) === id)} aria-pressed={lockSpotifyLookOf(theme.lockSpotifyLook) === id}>
                {label}
              </button>
            ))}
          </div>
          <h3 className={cn("micro-label pt-1", colors.accentText)}>Card colors</h3>
          <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
            How the message, note and Spotify cards look on the lock screen. Light suits a light wallpaper, with dark words on it. Auto looks at your wallpaper behind the cards and picks.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {([["dark", "Dark"], ["light", "Light"], ["auto", "Auto"]] as [LockCardChoice, string][]).map(([id, label]) => (
              <button key={id} onClick={() => onThemeChange({ lockCards: id })} className={chip(lockCardsOf(theme.lockCards) === id)} style={chipStyle(lockCardsOf(theme.lockCards) === id)} aria-pressed={lockCardsOf(theme.lockCards) === id}>
                {label}
              </button>
            ))}
          </div>
          {/* Off, the cards and the weather float on the wallpaper (theirs, Nov 8 2026). */}
          <h3 className={cn("micro-label pt-1", colors.accentText)}>Card behind</h3>
          <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
            Off takes the card out from behind the messages, the note, Spotify and the weather, so the words float on your wallpaper with a soft shadow. Good on a quiet wallpaper.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {([[true, "On"], [false, "Off"]] as [boolean, string][]).map(([on, label]) => (
              <button key={label} onClick={() => onThemeChange({ lockCardBacks: on })} className={chip(lockCardBacksOf(theme.lockCardBacks) === on)} style={chipStyle(lockCardBacksOf(theme.lockCardBacks) === on)} aria-pressed={lockCardBacksOf(theme.lockCardBacks) === on}>
                {label}
              </button>
            ))}
          </div>
        </section>
        {(() => {
          const corners = lockShortcutsOf(theme.lockShortcuts);
          const current = corners[lockCorner];
          const setCorner = (id: string | null) => {
            const next: [string | null, string | null] = [corners[0], corners[1]];
            next[lockCorner] = id;
            onThemeChange({ lockShortcuts: next });
          };
          return (
            <section className={cn("space-y-3 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
              <h3 className={cn("micro-label", colors.accentText)}>Shortcuts</h3>
              <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
                Two circles in the bottom corners of the lock screen. Each one opens its app straight away.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {([[0, "Left corner"], [1, "Right corner"]] as [0 | 1, string][]).map(([c, label]) => (
                  <button key={label} onClick={() => setLockCorner(c)} className={chip(lockCorner === c)} style={chipStyle(lockCorner === c)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setCorner(null)}
                  className={cn('flex items-center gap-2 px-3 py-2 rounded-xl border text-xs text-left', colors.panelBorder, colors.textMain)}
                  style={current === null ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)', borderColor: colors.accent } : undefined}
                >
                  <span className="flex-1 truncate">Nothing there</span>
                </button>
                {[...APPS].filter((a) => a.id !== 'settings').sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map((app) => (
                  <button
                    key={`lock-corner-${app.id}`}
                    onClick={() => setCorner(app.id)}
                    className={cn('flex items-center gap-2 px-3 py-2 rounded-xl border text-xs text-left', colors.panelBorder, colors.textMain)}
                    style={current === app.id ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)', borderColor: colors.accent } : undefined}
                  >
                    <app.icon size={14} />
                    <span className="flex-1 truncate">{nameOf(app)}</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })()}
        {/* Moving things, what is tucked away, and starting over. */}
        <section className={cn("space-y-3 p-4 rounded-2xl border", colors.panelBg, colors.panelBorder)}>
          <h3 className={cn("micro-label", colors.accentText)}>Layout</h3>
          <p className={cn("text-[10px] leading-relaxed", colors.textMuted)}>
            Hold any piece until it lifts, the clock, the weather, Spotify or a card, and drag it: a dashed box shows exactly where it will land. A piece let go of near another settles flush against it, and one dropped right on top of another sends that one to the nearest open spot. Drag the clock or the weather up to the top to hide it, and show it again from its own section above.
          </p>
          {(placed || movedAt || weatherMoved) && (
            <button onClick={() => onThemeChange({ lockSpots: undefined, lockClockAt: undefined, lockWeatherAt: undefined })} className={cn(chip(false), "w-full")}>
              Reset the layout
            </button>
          )}
        </section>
      </>);
    })()}
    </>
  );
}
