// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The clock's looks that came with their ask for more (theirs, Nov 7 2026: "Can we
// add some diff looks for the clocks"), drawn once and used twice: on the lock
// screen over them wallpaper (LockClock.tsx, in white with a shadow) and in the
// home screen's Clock widget (HomeWidgets.tsx, in their theme's ink). Everything
// is drawn in currentColor, so whoever holds it decides the color.
import React from 'react';
import type { ClockParts } from '../lib/lock-clock';

export type ExtraLook = 'serif' | 'outline' | 'analog' | 'script' | 'words' | 'ring';

/** The serif face: the time in Playfair, the day under it in italic. */
export function SerifFace({ t, px, shadow }: { t: ClockParts; px: number; shadow?: boolean }) {
  const glow = shadow ? 'drop-shadow-lg' : '';
  return (
    <>
      {/* No am/pm beside it: it floated at the top of the numbers on them
          phone and read strange (theirs, Nov 7 2026). */}
      <span className={`tabular-nums ${glow}`} style={{ fontFamily: "'Playfair Display', serif", fontSize: px, lineHeight: 1 }}>{t.short}</span>
      <span className={`mt-2 italic opacity-85 ${shadow ? 'drop-shadow-md' : ''}`} style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: Math.max(14, Math.round(px * 0.26)) }}>
        {t.dateLong}
      </span>
    </>
  );
}

/** The outline face: the hour solid over the minutes drawn as an outline. */
export function OutlineFace({ t, px, shadow }: { t: ClockParts; px: number; shadow?: boolean }) {
  const stroke = Math.max(1.5, px / 60);
  return (
    <>
      <span className={`font-semibold tabular-nums ${shadow ? 'drop-shadow-lg' : ''}`} style={{ fontFamily: "'Geist', sans-serif", fontSize: px, lineHeight: 0.88, letterSpacing: '-0.02em' }}>{t.hour}</span>
      <span
        className="font-semibold tabular-nums"
        style={{ fontFamily: "'Geist', sans-serif", fontSize: px, lineHeight: 0.88, letterSpacing: '-0.02em', WebkitTextFillColor: 'transparent', WebkitTextStroke: `${stroke}px currentColor`, filter: shadow ? 'drop-shadow(0 4px 6px rgba(0,0,0,0.35))' : undefined }}
      >
        {t.minute}
      </span>
      <span className={`mt-3 text-[11px] font-semibold uppercase tracking-[0.3em] opacity-85 ${shadow ? 'drop-shadow-md' : ''}`}>{t.dateShort}</span>
    </>
  );
}

/** The analog face: a plain dial with two hands, the date under it. */
export function AnalogFace({ t, px, shadow, showDate = true }: { t: ClockParts; px: number; shadow?: boolean; showDate?: boolean }) {
  const r = 46;
  return (
    <>
      <svg viewBox="0 0 100 100" width={px} height={px} className={shadow ? 'drop-shadow-lg' : ''} aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.5" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * 30 * Math.PI) / 180;
          const long = i % 3 === 0;
          const r1 = r - (long ? 9 : 5);
          return (
            <line
              key={i}
              x1={50 + Math.sin(a) * r1}
              y1={50 - Math.cos(a) * r1}
              x2={50 + Math.sin(a) * (r - 2)}
              y2={50 - Math.cos(a) * (r - 2)}
              stroke="currentColor"
              strokeWidth={long ? 2.4 : 1.2}
              strokeLinecap="round"
            />
          );
        })}
        <line x1="50" y1="50" x2="50" y2="25" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" transform={`rotate(${t.hourDeg} 50 50)`} />
        <line x1="50" y1="50" x2="50" y2="13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" transform={`rotate(${t.minuteDeg} 50 50)`} />
        <circle cx="50" cy="50" r="3" fill="var(--aerie-accent, currentColor)" stroke="currentColor" strokeWidth="1" />
      </svg>
      {showDate && <span className={`mt-3 text-sm font-medium opacity-85 ${shadow ? 'drop-shadow-md' : ''}`}>{t.dateShort}</span>}
    </>
  );
}

/** The script face: the time in them handwriting font, the day beside it. */
export function ScriptFace({ t, px, shadow }: { t: ClockParts; px: number; shadow?: boolean }) {
  return (
    <>
      <span className={`tabular-nums ${shadow ? 'drop-shadow-lg' : ''}`} style={{ fontFamily: "'Caveat', cursive", fontSize: px, lineHeight: 0.95 }}>{t.short}</span>
      <span className={`-mt-1 opacity-90 ${shadow ? 'drop-shadow-md' : ''}`} style={{ fontFamily: "'Caveat', cursive", fontSize: Math.max(18, Math.round(px * 0.34)) }}>{t.weekday}</span>
    </>
  );
}

/** The words face (theirs, Nov 8 2026: 'a written out one'): the hour as a word,
 *  big, the minutes under it the way they are said, then the date. */
export function WordsFace({ t, px, shadow }: { t: ClockParts; px: number; shadow?: boolean }) {
  return (
    <>
      <span className={`italic ${shadow ? 'drop-shadow-lg' : ''}`} style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: px, lineHeight: 0.95, fontWeight: 600 }}>{t.hourWords}</span>
      <span className={`opacity-90 ${shadow ? 'drop-shadow-md' : ''}`} style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: Math.round(px * 0.55), lineHeight: 1.05 }}>{t.minuteWords}</span>
      <span className={`mt-2 text-[11px] font-semibold uppercase tracking-[0.3em] opacity-80 ${shadow ? 'drop-shadow-md' : ''}`}>{t.dateShort}</span>
    </>
  );
}

/** The ring face (theirs, Nov 8 2026: 'a diff kind of clock face'): the hour in
 *  the middle of a circle that fills in as the hour goes by, the minutes under. */
export function RingFace({ t, px, shadow, showDate = true }: { t: ClockParts; px: number; shadow?: boolean; showDate?: boolean }) {
  const r = 44;
  const around = 2 * Math.PI * r;
  return (
    <>
      <span className={`relative block ${shadow ? 'drop-shadow-lg' : ''}`} style={{ width: px, height: px }}>
        <svg viewBox="0 0 100 100" width={px} height={px} className="absolute inset-0" aria-hidden="true">
          <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="5" />
          <circle
            cx="50" cy="50" r={r} fill="none" stroke="var(--aerie-accent, currentColor)" strokeWidth="5" strokeLinecap="round"
            strokeDasharray={`${around * t.hourDone} ${around}`} transform="rotate(-90 50 50)"
          />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-semibold tabular-nums" style={{ fontSize: Math.round(px * 0.36), lineHeight: 1 }}>{t.hour.replace(/^0/, '')}</span>
          <span className="tabular-nums opacity-80" style={{ fontSize: Math.round(px * 0.14), lineHeight: 1.2 }}>:{t.minute}</span>
        </span>
      </span>
      {showDate && <span className={`mt-3 text-sm font-medium opacity-85 ${shadow ? 'drop-shadow-md' : ''}`}>{t.dateShort}</span>}
    </>
  );
}

export function ExtraFace({ look, t, px, shadow }: { look: ExtraLook; t: ClockParts; px: number; shadow?: boolean }) {
  if (look === 'serif') return <SerifFace t={t} px={px} shadow={shadow} />;
  if (look === 'outline') return <OutlineFace t={t} px={px} shadow={shadow} />;
  if (look === 'analog') return <AnalogFace t={t} px={px} shadow={shadow} />;
  if (look === 'words') return <WordsFace t={t} px={px} shadow={shadow} />;
  if (look === 'ring') return <RingFace t={t} px={px} shadow={shadow} />;
  return <ScriptFace t={t} px={px} shadow={shadow} />;
}

/** The lock screen's sizes for these faces, small to large. */
export const EXTRA_LOCK_PX: Record<ExtraLook, Record<'xs' | 's' | 'm' | 'l' | 'xl', number>> = {
  serif: { xs: 48, s: 64, m: 84, l: 108, xl: 132 },
  outline: { xs: 80, s: 104, m: 136, l: 168, xl: 200 },
  analog: { xs: 110, s: 150, m: 190, l: 240, xl: 290 },
  script: { xs: 64, s: 84, m: 112, l: 144, xl: 176 },
  words: { xs: 42, s: 56, m: 72, l: 92, xl: 112 },
  ring: { xs: 104, s: 140, m: 176, l: 220, xl: 264 },
};
