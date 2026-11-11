// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The lock screen's clock, in whichever face their person picked, modeled on a
// phone's own Personalize page. The lock screen draws it over the wallpaper
// and Settings draws the very same thing small, so the preview picked from
// is never a different drawing from what the lock screen shows.
import React, { useEffect, useRef, useState } from 'react';
import { Cloud, CloudMoon, CloudSun, Moon, Sun, CloudRain, Snowflake, X } from 'lucide-react';
import { clampClockAt, clockParts, weatherWord, type ClockAt, type LockFace, type LockPiece, type LockPosition, type LockSize, type LockWeatherLook } from '../lib/lock-clock';
import { haptic } from '../lib/utils';
import { ExtraFace, EXTRA_LOCK_PX } from './ClockFaces';

export interface LockWeather {
  temp: number;
  code: number;
  /** Open-Meteo's own day-or-night flag for the phone's spot; absent on a reading kept from before it was asked for. */
  isDay?: boolean;
  /** Today's high and low, when the reading carried them. */
  high?: number;
  low?: number;
}

/** Day or night where the phone is: the reading's own flag, or the clock if an old reading has none. */
export function isDaytime(weather: Pick<LockWeather, 'isDay'>, now = new Date()): boolean {
  if (typeof weather.isDay === 'boolean') return weather.isDay;
  const hour = now.getHours();
  return hour >= 6 && hour < 19;
}

// A clear night draws a moon, not a sun, and a partly cloudy
// sky draws the cloud with the sun or the moon behind it.
export function weatherIcon(code: number, day = true, className = 'h-4 w-4', onLight = false) {
  // The pale set is for a dark wallpaper; on Daylight's pale paper the same
  // moon was white on white (theirs, Nov 8 2026), so a light ground gets deeper ink.
  const ink = onLight
    ? { sun: 'text-amber-500', sunCloud: 'text-amber-500', moon: 'text-slate-500', cloud: 'text-slate-500', rain: 'text-blue-500', snow: 'text-sky-500' }
    : { sun: 'text-yellow-300', sunCloud: 'text-yellow-200', moon: 'text-slate-200', cloud: 'text-white/80', rain: 'text-blue-300', snow: 'text-white' };
  if (code <= 1) return day ? <Sun className={`${className} ${ink.sun}`} /> : <Moon className={`${className} ${ink.moon}`} />;
  if (code === 2) return day ? <CloudSun className={`${className} ${ink.sunCloud}`} /> : <CloudMoon className={`${className} ${ink.moon}`} />;
  if (code <= 48) return <Cloud className={`${className} ${ink.cloud}`} />;
  if (code <= 67 || code >= 80) return <CloudRain className={`${className} ${ink.rain}`} />;
  return <Snowflake className={`${className} ${ink.snow}`} />;
}

interface LockClockProps {
  face: LockFace;
  position: LockPosition;
  size: LockSize;
  now: Date;
  weather: LockWeather | null;
  /** Where their person dragged this face's clock, or null for its own place. */
  at?: ClockAt | null;
  /** Given on the lock screen and nowhere else: holding the clock picks it
   *  up, and letting go leaves it where the finger is. */
  onMove?: (at: ClockAt) => void;
  /** The weather pill's spot and saving, the same way. */
  weatherAt?: ClockAt | null;
  onMoveWeather?: (at: ClockAt) => void;
  /** Whether each piece is showing; either can be tucked away. */
  showClock?: boolean;
  showWeather?: boolean;
  /** Given on the lock screen: a piece let go of in the strip at the top is
   *  tucked away instead of moved. */
  onHide?: (piece: LockPiece) => void;
}

// How long the clock has to be held before it lifts, and how far a finger
// can wander first; past that it was a swipe, not a hold.
const HOLD_MS = 450;
const HOLD_SLOP = 10;

/** The clock's own block: in the face's place, or wherever it was dragged,
 *  and on the lock screen, the thing a finger holds and moves. */
function Placed({
  piece,
  at,
  onMove,
  onHide,
  layout,
  homeClass,
  homeStyle,
  children,
}: {
  /** Which piece this is, on data-lock-piece: 'clock' or 'weather'. */
  piece: string;
  at: ClockAt | null;
  onMove?: (at: ClockAt) => void;
  /** Let go of in the strip at the top, the piece is tucked away instead. */
  onHide?: () => void;
  /** How the clock's own pieces sit together, wherever it is. */
  layout: string;
  /** Where the face puts it, until it is dragged somewhere else. */
  homeClass: string;
  homeStyle: React.CSSProperties;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<ClockAt | null>(null);
  const liveRef = useRef<ClockAt | null>(null);
  const [overStrip, setOverStrip] = useState(false);
  // armed: the strip only counts once the finger has been outside it, so a
  // piece that lives near the top can be lifted and set down without vanishing.
  const hold = useRef({ timer: 0, x: 0, y: 0, lastX: 0, lastY: 0, grabX: 0, grabY: 0, dragging: false, pointer: -1, armed: false, over: false });

  /** Whether a finger at this height is in the strip at the top. */
  const inStrip = (clientY: number) => {
    const r = strip.current?.getBoundingClientRect();
    const frame = ref.current?.parentElement?.getBoundingClientRect();
    const bottom = r ? r.bottom + 24 : (frame ? frame.top + 96 : 96);
    return clientY <= bottom;
  };
  const trackStrip = (clientY: number) => {
    const h = hold.current;
    if (!onHide) return;
    const inside = inStrip(clientY);
    if (!inside) h.armed = true;
    const over = h.armed && inside;
    if (over !== h.over) { h.over = over; setOverStrip(over); if (over) haptic(20); }
  };

  const show = (next: ClockAt | null) => { liveRef.current = next; setLive(next); };
  const stopTimer = () => { if (hold.current.timer) { window.clearTimeout(hold.current.timer); hold.current.timer = 0; } };
  useEffect(() => stopTimer, []);

  const placeFrom = (clientX: number, clientY: number) => {
    const el = ref.current;
    const frame = el?.parentElement?.getBoundingClientRect();
    if (!el || !frame) return;
    const box = el.getBoundingClientRect();
    show(clampClockAt(clientX - hold.current.grabX - frame.left, clientY - hold.current.grabY - frame.top, box.width, box.height, frame.width, frame.height));
  };

  const handlers = onMove ? {
    onPointerDown: (e: React.PointerEvent) => {
      const h = hold.current;
      stopTimer();
      h.x = h.lastX = e.clientX; h.y = h.lastY = e.clientY; h.pointer = e.pointerId; h.dragging = false;
      h.timer = window.setTimeout(() => {
        h.timer = 0;
        const el = ref.current;
        if (!el) return;
        const box = el.getBoundingClientRect();
        // Held from wherever the finger is on the clock, so it doesn't jump.
        h.grabX = h.lastX - (box.left + box.width / 2);
        h.grabY = h.lastY - (box.top + box.height / 2);
        h.dragging = true;
        h.armed = false; h.over = false; setOverStrip(false);
        haptic(55);
        try { el.setPointerCapture(h.pointer); } catch { /* the finger already left */ }
        placeFrom(h.lastX, h.lastY);
      }, HOLD_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const h = hold.current;
      h.lastX = e.clientX; h.lastY = e.clientY;
      if (!h.dragging) {
        if (Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP) stopTimer();
        return;
      }
      placeFrom(e.clientX, e.clientY);
      trackStrip(e.clientY);
    },
    onPointerUp: () => {
      stopTimer();
      const h = hold.current;
      if (!h.dragging) return;
      h.dragging = false;
      const spot = liveRef.current;
      const tuck = h.over && !!onHide;
      h.over = false; setOverStrip(false);
      show(null);
      if (tuck) { haptic(55); onHide!(); return; }
      if (spot) onMove(spot);
    },
    onPointerCancel: () => {
      stopTimer();
      hold.current.dragging = false;
      hold.current.over = false; setOverStrip(false);
      show(null);
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  } : {};

  const where = live ?? at;
  const placed: React.CSSProperties = where
    ? { left: `${where.x * 100}%`, top: `${where.y * 100}%`, transform: 'translate(-50%, -50%)' }
    : homeStyle;
  const lifted: React.CSSProperties = live
    ? { outline: '2px dashed rgba(255,255,255,0.7)', outlineOffset: 12, borderRadius: 16 }
    : {};
  return (
    <>
      <div
        ref={ref}
        data-lock-piece={piece}
        className={`absolute ${layout} ${where ? 'whitespace-nowrap' : homeClass} ${onMove ? 'pointer-events-auto select-none' : ''}`}
        style={{ ...placed, ...lifted, touchAction: onMove ? 'none' : undefined }}
        {...handlers}
      >
        {children}
      </div>
      {live && (
        <div
          ref={strip}
          className="absolute inset-x-0 flex justify-center"
          style={{ top: 'calc(var(--sat, 0px) + 14px)' }}
        >
          {onHide ? (
            <span
              className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors"
              style={overStrip
                ? { background: 'rgba(190, 40, 40, 0.85)', borderColor: 'rgba(255,255,255,0.5)' }
                : { background: 'rgba(0,0,0,0.55)', borderColor: 'rgba(255,255,255,0.2)' }}
            >
              <X className="h-3.5 w-3.5" />
              {overStrip ? 'Let go to hide it' : 'Drag up here to hide'}
            </span>
          ) : (
            <span className="rounded-full border border-white/20 bg-black/55 px-3 py-1 text-xs font-medium">Let go to leave it here</span>
          )}
        </div>
      )}
    </>
  );
}

// Medium is today's clock on every face, so nothing changes until another
// size is picked; every face takes one, not only the classic.
// Top is where the classic clock has always sat.
const CLASSIC_SIZE: Record<LockSize, string> = { xs: 'text-3xl', s: 'text-4xl', m: 'text-5xl', l: 'text-7xl', xl: 'text-8xl' };
const STACKED_PX: Record<LockSize, number> = { xs: 80, s: 104, m: 136, l: 168, xl: 200 };
const DATELINE_PX: Record<LockSize, number> = { xs: 28, s: 36, m: 46, l: 60, xl: 74 };
const CLASSIC_TOP: Record<LockPosition, string> = {
  top: 'calc(var(--sat, 0px) + 24px)',
  middle: '34%',
  low: '54%',
};

/** The clock's own drawing in a face and size, with nothing about where it
 *  sits: the lock screen's grid places it (lib/lock-grid.ts), and LockClock
 *  below places it the old way for Settings' small preview. */
export function ClockFaceBody({ face, size, now }: { face: LockFace; size: LockSize; now: Date }) {
  const t = clockParts(now);
  if (face === 'stacked') {
    return (
      <div className="flex flex-col items-center text-white">
        <span className="font-normal tabular-nums drop-shadow-lg" style={{ fontSize: STACKED_PX[size], lineHeight: 0.9 }}>{t.hour}</span>
        <span className="font-normal tabular-nums drop-shadow-lg" style={{ fontSize: STACKED_PX[size], lineHeight: 0.9 }}>{t.minute}</span>
        <span className="mt-5 text-base font-medium text-white/85 drop-shadow-md">{t.dateShort}</span>
      </div>
    );
  }
  if (face === 'serif' || face === 'outline' || face === 'analog' || face === 'script' || face === 'words' || face === 'ring') {
    return (
      <div className="flex flex-col items-center text-white">
        <ExtraFace look={face} t={t} px={EXTRA_LOCK_PX[face][size]} shadow />
      </div>
    );
  }
  if (face === 'dateline') {
    return (
      <div className="flex items-baseline justify-center gap-3 whitespace-nowrap text-white">
        <span className="tabular-nums drop-shadow-lg" style={{ fontSize: DATELINE_PX[size], lineHeight: 1 }}>{t.short}</span>
        <span className="text-sm font-medium text-white/85 drop-shadow-md">{t.dateShort}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center whitespace-nowrap text-white">
      <h1 className={`${CLASSIC_SIZE[size]} font-light tracking-tight drop-shadow-lg`}>{t.classic}</h1>
      <p className="mt-1 text-sm font-medium text-white/80 drop-shadow-md">{t.dateLong}</p>
    </div>
  );
}

/** The weather in one of its looks (theirs, Nov 8 2026): the pill it always
 *  was, a bare line of text, a big temperature, or a card with the day's
 *  high and low. */
export function WeatherBody({ weather, look = 'pill', backs = true }: { weather: LockWeather; look?: LockWeatherLook; backs?: boolean }) {
  // Off, the pill and the card lose their tint and float like the rest.
  const tint = backs ? '' : ' !border-transparent !bg-transparent drop-shadow-md';
  const day = isDaytime(weather);
  const hiLo = typeof weather.high === 'number' && typeof weather.low === 'number' ? `H ${Math.round(weather.high)}° · L ${Math.round(weather.low)}°` : null;
  if (look === 'line') {
    return (
      <div className="flex items-center gap-1.5 whitespace-nowrap text-white drop-shadow-md">
        {weatherIcon(weather.code, day, 'h-4 w-4')}
        <span className="text-sm font-medium">{weather.temp}°</span>
        <span className="text-sm text-white/80">{weatherWord(weather.code)}</span>
      </div>
    );
  }
  if (look === 'big') {
    return (
      <div className="flex items-center gap-2 whitespace-nowrap text-white drop-shadow-lg">
        {weatherIcon(weather.code, day, 'h-9 w-9')}
        <span className="flex flex-col leading-none">
          <span className="text-4xl font-light tabular-nums">{weather.temp}°</span>
          <span className="mt-1 text-xs font-medium text-white/85">{hiLo ?? weatherWord(weather.code)}</span>
        </span>
      </div>
    );
  }
  if (look === 'card') {
    return (
      <div className={`flex min-w-[9.5rem] flex-col gap-1 whitespace-nowrap rounded-[var(--shape-surface)] border border-white/10 bg-black/35 px-3.5 py-2.5 text-white${tint}`}>
        <span className="flex items-center gap-2">
          {weatherIcon(weather.code, day, 'h-6 w-6')}
          <span className="text-2xl font-light tabular-nums">{weather.temp}°</span>
        </span>
        <span className="text-xs font-medium text-white/90">{weatherWord(weather.code)}</span>
        {hiLo && <span className="text-[11px] text-white/70">{hiLo}</span>}
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-1.5 whitespace-nowrap rounded-[var(--shape-control)] border border-white/10 bg-black/30 px-3 py-1.5 text-white${tint}`}>
      {weatherIcon(weather.code, day)}
      <span className="text-xs font-medium">{weather.temp}°F</span>
    </div>
  );
}

function WeatherPill({ weather, at, onMove, onHide }: { weather: LockWeather; at: ClockAt | null; onMove?: (at: ClockAt) => void; onHide?: () => void }) {
  return (
    <Placed
      piece="weather"
      at={at}
      onMove={onMove}
      onHide={onHide}
      layout="flex items-center gap-1.5 rounded-[var(--shape-control)] bg-black/30 px-3 py-1.5 border border-white/10"
      homeClass="top-12 right-4"
      homeStyle={{ marginTop: 'var(--sat)' }}
    >
      {weatherIcon(weather.code, isDaytime(weather))}
      <span className="text-xs font-medium">{weather.temp}°F</span>
    </Placed>
  );
}

/** Fills its parent. Nothing in it takes a touch except, on the lock screen,
 *  the clock itself, which lifts when held; the swipe along the bottom
 *  still unlocks. */
export function LockClock({ face, position, size, now, weather, at = null, onMove, weatherAt = null, onMoveWeather, showClock = true, showWeather = true, onHide }: LockClockProps) {
  const t = clockParts(now);
  // The weather pill is its own piece on every face now, the dateline's too,
  // and either piece can be tucked away.
  const pill = weather && showWeather
    ? <WeatherPill weather={weather} at={weatherAt} onMove={onMoveWeather} onHide={onHide ? () => onHide('weather') : undefined} />
    : null;
  const hideClock = onHide ? () => onHide('clock') : undefined;

  if (face === 'stacked') {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 text-white">
        {pill}
        {showClock && (
          <Placed
            piece="clock"
            at={at}
            onMove={onMove}
            onHide={hideClock}
            layout="flex flex-col items-center"
            homeClass="inset-x-0"
            homeStyle={{ top: 'calc(var(--sat, 0px) + 56px)' }}
          >
            <span className="font-normal tabular-nums drop-shadow-lg" style={{ fontSize: STACKED_PX[size], lineHeight: 0.9 }}>
              {t.hour}
            </span>
            <span className="font-normal tabular-nums drop-shadow-lg" style={{ fontSize: STACKED_PX[size], lineHeight: 0.9 }}>
              {t.minute}
            </span>
            <span className="mt-5 text-base font-medium text-white/85 drop-shadow-md">{t.dateShort}</span>
          </Placed>
        )}
      </div>
    );
  }

  // The looks that came on Nov 7 2026 (ClockFaces.tsx), placed like the
  // stacked face: up top in the middle until they move it.
  if (face === 'serif' || face === 'outline' || face === 'analog' || face === 'script' || face === 'words' || face === 'ring') {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 text-white">
        {pill}
        {showClock && (
          <Placed
            piece="clock"
            at={at}
            onMove={onMove}
            onHide={hideClock}
            layout="flex flex-col items-center"
            homeClass="inset-x-0"
            homeStyle={{ top: 'calc(var(--sat, 0px) + 64px)' }}
          >
            <ExtraFace look={face} t={t} px={EXTRA_LOCK_PX[face][size]} shadow />
          </Placed>
        )}
      </div>
    );
  }

  if (face === 'dateline') {
    // The top of the screen is left to the picture; the time rides along the
    // bottom, just above the unlock hint, until it is moved. The weather is
    // the pill now, like every face, so it can be moved or tucked away.
    return (
      <div className="pointer-events-none absolute inset-0 z-10 text-white">
        {pill}
        {showClock && (
          <Placed
            piece="clock"
            at={at}
            onMove={onMove}
            onHide={hideClock}
            layout="flex items-baseline justify-center gap-3"
            homeClass="inset-x-0 px-6"
            homeStyle={{ bottom: 'calc(var(--sab, 0px) + 124px)' }}
          >
            <span className="tabular-nums drop-shadow-lg" style={{ fontSize: DATELINE_PX[size], lineHeight: 1 }}>
              {t.short}
            </span>
            <span className="text-sm font-medium text-white/85 drop-shadow-md">{t.dateShort}</span>
          </Placed>
        )}
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10 text-white">
      {pill}
      {showClock && (
        <Placed
          piece="clock"
          at={at}
          onMove={onMove}
          onHide={hideClock}
          layout="flex flex-col items-center"
          homeClass="inset-x-0"
          homeStyle={{ top: CLASSIC_TOP[position] }}
        >
          <h1 className={`${CLASSIC_SIZE[size]} font-light tracking-tight drop-shadow-lg`}>{t.classic}</h1>
          <p className="mt-1 text-sm font-medium text-white/80 drop-shadow-md">{t.dateLong}</p>
        </Placed>
      )}
    </div>
  );
}

// The phone the preview is drawn at, then shrunk to fit: the faces are laid
// out in real pixels, so they are drawn full size and scaled as one picture.
const PREVIEW_W = 390;
const PREVIEW_H = 844;

/** A small, live copy of the lock screen for Settings. */
export function LockPreview({
  face,
  position,
  size,
  wallpaper,
  width,
  at = null,
  showClock = true,
}: {
  face: LockFace;
  position: LockPosition;
  size: LockSize;
  wallpaper?: string;
  width: number;
  /** Where this face's clock was dragged on the lock screen, if it was. */
  at?: ClockAt | null;
  /** False when the clock is tucked away, so the live preview matches. */
  showClock?: boolean;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const scale = width / PREVIEW_W;
  return (
    <div
      className="relative overflow-hidden bg-black"
      style={{ width, height: PREVIEW_H * scale, borderRadius: 14 * (width / 96) }}
      aria-hidden="true"
    >
      <div
        className="absolute left-0 top-0"
        style={{ width: PREVIEW_W, height: PREVIEW_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}
      >
        {wallpaper ? (
          <div className="absolute inset-0 bg-cover bg-center opacity-60" style={{ backgroundImage: `url(${wallpaper})` }} />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900 to-black opacity-80" />
        )}
        {/* Every face centered in its preview (theirs, Nov 8 2026), so the faces
            compare side by side; where it sits is the lock screen's grid's job. */}
        {showClock && (
          <div className="absolute inset-0 flex items-center justify-center">
            <ClockFaceBody face={face} size={size} now={now} />
          </div>
        )}
      </div>
    </div>
  );
}
