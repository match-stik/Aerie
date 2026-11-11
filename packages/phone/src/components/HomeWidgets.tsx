// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The home screen's widgets: they sit low in the empty middle so the
// wallpaper keeps the top of the screen, on the same solid surface as the
// dock, because every surface in the house is solid. lib/home-widgets.ts
// decides what each one shows.
import { themeInk } from '../lib/theme-ink';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Heart, Mail } from 'lucide-react';
import { apiFetch, sendUserMessageToThread, useAerie } from '../aerie';
import { ageLabel, clockParts, HOME_CLOCK_LOOKS, type HomeClockLook } from '../lib/lock-clock';
import { AnalogFace, ExtraFace, RingFace } from './ClockFaces';
import { Cover, Controls, type PressState } from './spotify/SpotifyViews';
import { useSpotifyNow } from '../lib/use-spotify-now';
import { createLockSpotify, lockSpotifyTrack, type LockSpotifyLook } from '../lib/lock-spotify';
import { wakeSpotify } from '../aerie/spotify-wake';
import {
  GRID_COLS,
  HOME_WIDGETS,
  latestCompanionNote,
  layoutHeight,
  fitWidgets,
  lookSizes,
  placeWidget,
  ROW_PARTS,
  sizeLabel,
  sizeOf,
  replyLines,
  skyWord,
  waitingLetter,
  type HomeWidget,
  type Layout,
  type Spot,
  HOME_WEATHER_LOOKS,
  type HomeWeatherLook,
} from '../lib/home-widgets';
import { resolveNoteColor, paperFor, noteInk } from '../lib/note-colors';
import { haptic } from '../lib/utils';
import { liveStatus } from '../lib/statuses';
import { HOME_WORD } from '../lib/presence-word';
import { StatusIcon } from './Statuses';
import { onDraftChange, readDraft, writeDraft } from '../lib/thread-drafts';
import { isDaytime, weatherIcon } from './LockClock';
import { useWeather } from './useWeather';

export interface WidgetCompanion {
  slug: string;
  name: string;
  avatar: string | null;
  color: string | null;
  /** His header sigil, for the three of us written as one entry. */
  sigil?: string | null;
}

// The card under a widget. With the home screen's cards off (Nov 8 2026)
// index.css turns both variables transparent and the widget floats.
const surface: React.CSSProperties = {
  background: 'var(--aerie-widget-bg, var(--aerie-surface))',
  border: '1px solid var(--aerie-widget-line, var(--aerie-hairline))',
  color: 'var(--aerie-text)',
};

function Faces({ companions, size }: { companions: WidgetCompanion[]; size: number }) {
  return (
    <span className="flex shrink-0 -space-x-2">
      {companions.slice(0, 3).map((c, i) => (
        <span
          key={c.slug}
          className="overflow-hidden rounded-full border-2"
          style={{ width: size, height: size, borderColor: c.color || 'var(--aerie-hairline)', zIndex: 3 - i, background: 'var(--aerie-surface-strong)' }}
        >
          {c.avatar && <img src={c.avatar} alt="" className="h-full w-full object-cover" />}
        </span>
      ))}
    </span>
  );
}

/** The newest companion reply in the active thread, with its age. */
function useLatestReply() {
  const activeThreadId = useAerie((s) => s.activeThreadId);
  const messages = useAerie((s) => s.messages);
  const threads = useAerie((s) => s.threads);
  const thread = threads.find((t) => t.id === activeThreadId) ?? null;
  let last = null as (typeof messages)[number] | null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'companion' && (!thread || m.thread_id === thread.id)) { last = m; break; }
  }
  return { thread, last };
}

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** True while a text field has the keyboard up. */
function typingNow(): boolean {
  const el = typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'TEXTAREA' || (tag === 'INPUT' && !['button', 'checkbox', 'radio', 'range', 'submit'].includes((el as HTMLInputElement).type)) || el.isContentEditable;
}

/** A row that scrolls sideways when it is wider than its room, and sits still when it fits. */
function Ticker({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const outer = useRef<HTMLSpanElement | null>(null);
  const inner = useRef<HTMLSpanElement | null>(null);
  const [moving, setMoving] = useState(false);
  const [seconds, setSeconds] = useState(12);
  useEffect(() => {
    const measure = () => {
      const box = outer.current, row = inner.current;
      if (!box || !row) return;
      const wide = row.scrollWidth > box.clientWidth + 1;
      setMoving(wide);
      // About 30 px a second, whatever the length, so a long line is not a blur.
      if (wide) setSeconds(Math.max(8, Math.round((row.scrollWidth + 32) / 30)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(measure);
    if (outer.current) watch.observe(outer.current);
    if (inner.current) watch.observe(inner.current);
    return () => watch.disconnect();
  }, [children]);
  return (
    <span ref={outer} className={`relative block min-w-0 overflow-hidden whitespace-nowrap ${className ?? ''}`} style={style}>
      <span
        className="inline-flex items-center gap-8"
        style={moving ? { animation: `aerie-ticker ${seconds}s linear infinite` } : undefined}
      >
        <span ref={inner} className="inline-flex items-center gap-2.5">{children}</span>
        {moving && <span aria-hidden className="inline-flex items-center gap-2.5">{children}</span>}
      </span>
    </span>
  );
}

function CompanionsWidget({ companions, customEmojis, onOpen }: { companions: WidgetCompanion[]; customEmojis?: import('../types').CustomEmoji[]; onOpen: () => void }) {
  const { thread, last } = useLatestReply();
  const now = useNow(30_000);
  // The same unsent draft as the chat's own box (lib/thread-drafts.ts): start
  // an answer here, open the chat, and it is waiting there, and back again.
  const threadId = thread?.id ?? null;
  const [draft, setDraftState] = useState(() => readDraft(threadId));
  useEffect(() => { setDraftState(readDraft(threadId)); }, [threadId]);
  useEffect(() => onDraftChange((change) => {
    if (change.from !== 'widget' && change.threadId === threadId) setDraftState(change.text);
  }), [threadId]);
  const setDraft = (text: string) => { setDraftState(text); writeDraft(threadId, text, 'widget'); };
  // Where we are, at a glance (lib/statuses.ts): the shared status and any of
  // ours that is set, on one line. All of us at Home says nothing, so the reply
  // keeps its room.
  const statuses = useAerie((s) => s.statuses);
  const shared = liveStatus(statuses.shared, now);
  const ours = companions
    .map((c) => ({ c, s: liveStatus(statuses.companions[c.slug], now) }))
    .filter((x): x is { c: WidgetCompanion; s: NonNullable<typeof x.s> } => !!x.s);
  // Theirs rides the same line (theirs, Oct 27 2026: 'Mine doesn't scroll with
  // yours though'). It never fades, so with theirs set the line is always there,
  // and when none of ours is set the three of us still show as one Home entry
  // beside their person ('the boys one still scrolls with mine'). Three of ours saying
  // the same thing collapse into one entry, the way the shared one reads.
  const theirs = liveStatus(statuses.owner, now);
  const sameText = ours.length === companions.length && ours.length > 1
    && ours.every(({ s: st }) => st.text === ours[0].s.text && (st.icon ?? '') === (ours[0].s.icon ?? ''));
  const sigils = companions.map((c) => c.sigil).filter(Boolean).join('');
  const usFallback = !shared && (ours.length === 0 || sameText) && theirs
    ? { icon: sameText ? (ours[0].s.icon || sigils || null) : (sigils || null), text: sameText ? ours[0].s.text : HOME_WORD }
    : null;
  const oursShown = sameText ? [] : ours;
  const anyStatus = !!shared || ours.length > 0 || !!theirs;
  // Two lines under the status ticker too, an opening action included; there is
  // room for both (their person's ask, Oct 26 2026).
  const lines = last ? replyLines(last.content, 2) : [];
  const send = () => {
    const text = draft.trim();
    if (!text || !thread) return;
    sendUserMessageToThread(thread.id, text);
    haptic(55);
    setDraft('');
  };
  return (
    <div className="flex h-full flex-col gap-2 rounded-[var(--shape-surface)] p-3" style={surface}>
      {/* Holding focus on the draft (the same two lines as the send button
          below) so the first tap opens the chat instead of only closing the
          keyboard (their person's catch, Oct 26 2026). The draft itself carries over through lib/thread-drafts. */}
      <button type="button" onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={onOpen} className="flex min-w-0 flex-1 flex-col gap-1 text-left">
        <span className="flex items-center gap-2">
          <Faces companions={companions} size={24} />
          <span className="min-w-0 flex-1 truncate text-base font-semibold">{thread?.name || 'Messages'}</span>
          {last && <span className="text-[11px]" style={{ color: 'var(--aerie-text-muted)' }}>{ageLabel(Date.parse(last.created_at), now)}</span>}
        </span>
        {anyStatus && (
          // The statuses go by in a line instead of squeezing side by side
          // (their person's ask, Oct 26 2026); a
          // line that fits sits still.
          <Ticker className="text-[11px]" style={{ color: 'var(--aerie-text-muted)' }}>
            {shared && (
              <span className="flex shrink-0 items-center gap-1">
                {shared.icon && <StatusIcon icon={shared.icon} customEmojis={customEmojis} />}
                <span>{shared.text}</span>
              </span>
            )}
            {usFallback && (
              <span className="flex shrink-0 items-center gap-1">
                {usFallback.icon && <StatusIcon icon={usFallback.icon} customEmojis={customEmojis} />}
                <span>{usFallback.text}</span>
              </span>
            )}
            {oursShown.map(({ c, s: st }) => (
              <span key={c.slug} className="flex shrink-0 items-center gap-1">
                {st.icon ? <StatusIcon icon={st.icon} customEmojis={customEmojis} /> : <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.color || 'currentColor' }} />}
                <span><span className="font-semibold">{c.name}</span> {st.text}</span>
              </span>
            ))}
            {theirs && (
              <span className="flex shrink-0 items-center gap-1">
                {theirs.icon && <StatusIcon icon={theirs.icon} customEmojis={customEmojis} />}
                <span><span className="font-semibold">You</span> {theirs.text}</span>
              </span>
            )}
          </Ticker>
        )}
        {lines.length > 0 ? lines.map((l, i) => (
          <span
            key={i}
            // Under a status ticker each line gets one row, so the box keeps its
            // padding under their answer field (their person's ask, Oct 26 2026: two long lines
            // 'shoved everything out of the box', and three left no room under it).
            className={l.action ? 'truncate text-xs italic' : anyStatus ? 'truncate text-sm' : 'line-clamp-2 text-sm'}
            style={l.action ? { color: 'var(--aerie-text-muted)' } : undefined}
          >
            {l.text}
          </span>
        )) : (
          <span className="text-sm" style={{ color: 'var(--aerie-text-muted)' }}>Nothing new yet.</span>
        )}
      </button>
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="Answer…"
          className="min-w-0 flex-1 rounded-full px-3 py-1.5 text-sm outline-none"
          style={{ background: 'var(--aerie-surface-strong)', border: '1px solid var(--aerie-hairline)', color: 'var(--aerie-text)' }}
        />
        <button
          type="button"
          // The press must not take the focus off the box: when it did, the
          // keyboard dropped and the page moved under their person thumb, so the first
          // tap only closed the keyboard and the second one sent (their person's ask, Oct 26
          // 2026). Holding the focus keeps everything where it was.
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={send}
          disabled={!draft.trim() || !thread}
          aria-label="Send"
          className="flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-40"
          style={{ background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' }}
        >
          <Heart size={15} />
        </button>
      </div>
    </div>
  );
}

interface NoteRow { id: string | number; text: string; color: string; timestamp: string; sender: string | null }

function NoteWidget({ companions, palette, mode, onOpen }: { companions: WidgetCompanion[]; palette: string[]; mode: 'light' | 'dark'; onOpen: () => void }) {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  useEffect(() => {
    let gone = false;
    const load = () => apiFetch('/api/notes').then((r) => (r.ok ? r.json() : [])).then((rows) => { if (!gone && Array.isArray(rows)) setNotes(rows); }).catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    return () => { gone = true; clearInterval(timer); };
  }, []);
  const note = latestCompanionNote(notes, companions.map((c) => c.slug));
  if (!note) {
    return (
      <button type="button" onClick={onOpen} className="flex h-full items-center justify-center rounded-[var(--shape-surface)] p-3 text-center text-xs" style={{ ...surface, color: 'var(--aerie-text-muted)' }}>
        No note on the fridge yet.
      </button>
    );
  }
  // The same paper and ink the Notes app paints, so the fridge note and the
  // board agree (their person's ask, Oct 25 2026).
  const writer = companions.find((c) => c.slug.toLowerCase() === (note.sender || '').toLowerCase());
  // Ours always wear our own colour on the fridge too, the same as the board.
  const paint = paperFor(writer?.color || resolveNoteColor(note.color, palette) || palette[0] || '#FDE68A', mode);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full w-full flex-col justify-between p-3 text-left shadow-lg"
      style={{ background: paint, color: noteInk(mode), textShadow: 'none', transform: 'rotate(-2.5deg)', borderRadius: 6, fontFamily: "'Caveat', 'Segoe Print', 'Bradley Hand', cursive" }}
    >
      <span className="line-clamp-5 text-base leading-snug">{note.text}</span>
      {/* Signed in the paper's own ink: a writer's color can be the
          paper's color (an orange companion on an orange note). The writer's
          color rides in the little dot instead. */}
      <span className="flex items-center gap-1.5 self-end text-lg font-bold">
        <span className="h-2 w-2 rounded-full" style={{ background: writer?.color || 'currentColor', outline: '1px solid currentColor' }} />
        — {(writer?.name || note.sender || '?').charAt(0).toUpperCase()}
      </span>
    </button>
  );
}

function WeatherWidget({ onOpen, onLight = false, look = 'card' }: { onOpen: () => void; onLight?: boolean; look?: HomeWeatherLook }) {
  const weather = useWeather();
  const day = weather ? isDaytime(weather) : true;
  const hiLo = weather && typeof weather.high === 'number' && typeof weather.low === 'number' ? `H ${weather.high}° · L ${weather.low}°` : null;
  // The lock screen's looks, drawn in the theme's own ink (theirs, Nov 9 2026).
  if (look === 'big') {
    return (
      <button type="button" onClick={onOpen} className="flex h-full w-full items-center justify-center gap-2.5 rounded-[var(--shape-surface)] px-3 text-left" style={surface}>
        <span className="shrink-0">{weather ? weatherIcon(weather.code, day, 'h-10 w-10', onLight) : null}</span>
        <span className="flex min-w-0 flex-col leading-none">
          <span className="text-4xl font-light tabular-nums">{weather ? `${weather.temp}°` : '—'}</span>
          <span className="mt-1 truncate text-[11px]" style={{ color: 'var(--aerie-text-muted)' }}>{weather ? (hiLo ?? skyWord(weather.code)) : 'Looking at the sky'}</span>
        </span>
      </button>
    );
  }
  if (look === 'line') {
    return (
      <button type="button" onClick={onOpen} className="flex h-full w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--shape-surface)] px-3" style={surface}>
        {weather ? weatherIcon(weather.code, day, 'h-4 w-4', onLight) : null}
        <span className="text-sm font-medium">{weather ? `${weather.temp}°` : '—'}</span>
        <span className="truncate text-sm" style={{ color: 'var(--aerie-text-muted)' }}>{weather ? skyWord(weather.code) : 'Looking at the sky'}</span>
      </button>
    );
  }
  if (look === 'pill') {
    return (
      <button type="button" onClick={onOpen} className="flex h-full w-full items-center justify-center" aria-label="Weather">
        <span className="flex items-center gap-1.5 whitespace-nowrap rounded-[var(--shape-control)] px-3 py-1.5" style={surface}>
          {weather ? weatherIcon(weather.code, day, 'h-4 w-4', onLight) : null}
          <span className="text-xs font-medium">{weather ? `${weather.temp}°F` : '—'}</span>
        </span>
      </button>
    );
  }
  // The card fills its square, so today's high and low sit on its far side
  // to give the room something to hold; a long sky word takes the middle and
  // the high and low stay put.
  return (
    <button type="button" onClick={onOpen} className="flex h-full w-full items-center gap-3 rounded-[var(--shape-surface)] px-3 text-left" style={surface}>
      <span className="shrink-0">{weather ? weatherIcon(weather.code, isDaytime(weather), 'h-7 w-7', onLight) : null}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-2xl leading-none">{weather ? `${weather.temp}°` : '—'}</span>
        <span className="truncate text-[11px]" style={{ color: 'var(--aerie-text-muted)' }}>{weather ? skyWord(weather.code) : 'Looking at the sky'}</span>
      </span>
      {weather && typeof weather.high === 'number' && typeof weather.low === 'number' && (
        <span className="flex shrink-0 flex-col items-end text-[11px] leading-tight" style={{ color: 'var(--aerie-text-muted)' }}>
          <span>H {weather.high}°</span>
          <span>L {weather.low}°</span>
        </span>
      )}
    </button>
  );
}

interface LetterRow { author: string; hidden: boolean; state: string; written_at: string }

function LetterWidget({ companions, onOpen }: { companions: WidgetCompanion[]; onOpen: () => void }) {
  const [letters, setLetters] = useState<LetterRow[]>([]);
  useEffect(() => {
    let gone = false;
    const load = () => apiFetch('/api/letters').then((r) => (r.ok ? r.json() : [])).then((rows) => {
      const list = Array.isArray(rows) ? rows : Array.isArray(rows?.letters) ? rows.letters : [];
      if (!gone) setLetters(list);
    }).catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    return () => { gone = true; clearInterval(timer); };
  }, []);
  const slugs = new Set(companions.map((c) => c.slug.toLowerCase()));
  const letter = waitingLetter(letters.filter((l) => slugs.has(String(l.author).toLowerCase())), null);
  if (!letter) return null;
  const from = companions.find((c) => c.slug.toLowerCase() === letter.author.toLowerCase());
  return (
    <button type="button" onClick={onOpen} className="flex h-full items-center gap-3 rounded-[var(--shape-surface)] px-3 text-left" style={surface}>
      <Mail size={20} style={{ color: from ? themeInk(from.slug, from.color) : 'var(--aerie-accent)' }} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold">A letter waiting</span>
        <span className="truncate text-[11px]" style={{ color: 'var(--aerie-text-muted)' }}>from {from?.name || letter.author}</span>
      </span>
    </button>
  );
}

/** The Clock widget, in whichever look they picked in the widget sheet
 *  (theirs, Nov 7 2026: different looks for the clocks on the home screen). */
function ClockWidget({ look }: { look: HomeClockLook }) {
  const now = useNow(15_000);
  const t = clockParts(new Date(now));
  // No card, and one row tall (theirs, Nov 8 2026: trim the padding, there are
  // only so many places to put everything), so every look fits in one row's
  // height, about 76px; the two-line looks drop the date to fit.
  let face: React.ReactNode;
  if (look === 'stacked') {
    face = (
      <>
        <span className="tabular-nums" style={{ fontSize: 32, lineHeight: 0.92 }}>{t.hour}</span>
        <span className="tabular-nums" style={{ fontSize: 32, lineHeight: 0.92 }}>{t.minute}</span>
      </>
    );
  } else if (look === 'classic') {
    face = (
      <>
        <span className="font-light tracking-tight" style={{ fontSize: 26, lineHeight: 1.1 }}>{t.classic}</span>
        <span className="text-[10px] opacity-80">{t.dateShort}</span>
      </>
    );
  } else if (look === 'analog') {
    face = <AnalogFace t={t} px={68} showDate={false} />;
  } else if (look === 'ring') {
    face = <RingFace t={t} px={68} showDate={false} />;
  } else if (look === 'outline') {
    face = (
      <>
        <span className="font-semibold tabular-nums" style={{ fontFamily: "'Geist', sans-serif", fontSize: 32, lineHeight: 0.9 }}>{t.hour}</span>
        <span className="font-semibold tabular-nums" style={{ fontFamily: "'Geist', sans-serif", fontSize: 32, lineHeight: 0.9, WebkitTextFillColor: 'transparent', WebkitTextStroke: '1.5px currentColor' }}>{t.minute}</span>
      </>
    );
  } else if (look === 'words') {
    face = (
      <>
        <span className="italic" style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 30, lineHeight: 1, fontWeight: 600 }}>{t.hourWords}</span>
        <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, lineHeight: 1.1 }}>{t.minuteWords}</span>
      </>
    );
  } else {
    const px = look === 'serif' ? 34 : 40;
    face = <ExtraFace look={look} t={t} px={px} />;
  }
  return (
    // The clock wears the widgets' card like everything else when the cards are
    // on, and floats when they're off (theirs, Nov 8 2026: every card switches).
    <div
      className="flex h-full flex-col items-center justify-center overflow-hidden rounded-[var(--shape-surface)] px-2"
      style={{ ...surface, color: 'var(--aerie-text)', filter: 'var(--aerie-float-drop)' }}
    >
      {face}
    </div>
  );
}

/** The Spotify widget (theirs, Nov 7 2026): what is playing, with its buttons,
 *  read the same way the lock screen's card reads it. Nothing playing is a
 *  quiet line that opens Spotify. */
function MusicWidget({ onOpen, look = 'bar' }: { onOpen: () => void; look?: LockSpotifyLook }) {
  const [lock] = useState(() => createLockSpotify(apiFetch, undefined, wakeSpotify));
  const state = useSpotifyNow(lock.keeper);
  useEffect(() => {
    void lock.start();
    const woke = () => { if (document.visibilityState === 'visible') void lock.look(); };
    document.addEventListener('visibilitychange', woke);
    return () => { document.removeEventListener('visibilitychange', woke); lock.stop(); };
  }, [lock]);
  const view = lockSpotifyTrack(state);
  const track = view?.track;
  if (!view || !track) {
    return (
      <button type="button" onClick={onOpen} className="flex h-full w-full items-center gap-3 rounded-[var(--shape-surface)] px-4 text-left" style={surface}>
        <span className="text-sm font-semibold">Spotify</span>
        <span className="text-xs" style={{ color: 'var(--aerie-text-muted)' }}>Nothing playing</span>
      </button>
    );
  }
  const press: PressState = {
    pressing: state.pressing,
    notice: state.notice,
    onPress: (what, where) => void lock.keeper.press(what, where),
  };
  // The record: no card, stacked in half the width (theirs, Nov 8 2026: the way
  // it sits on the lock screen): a round cover, the song under it, the
  // buttons under that, floating on them wallpaper.
  if (look === 'cover') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 rounded-[var(--shape-surface)] px-2" style={{ ...surface, color: 'var(--aerie-text)', filter: 'var(--aerie-float-drop)' }}>
        <button type="button" onClick={onOpen} aria-label={`Open Spotify: ${track.name}`} className="flex w-full min-w-0 flex-col items-center gap-1 text-center">
          <span className="block h-[4.5rem] w-[4.5rem] shrink-0 overflow-hidden rounded-full ring-2" style={{ ['--tw-ring-color' as string]: 'var(--aerie-hairline)' }}>
            <Cover src={track.cover} className="h-full w-full object-cover" />
          </span>
          <span className="block w-full truncate text-sm font-semibold">{track.name}</span>
          {track.artist && <span className="-mt-1 block w-full truncate text-xs opacity-80">{track.artist}</span>}
        </button>
        <Controls playing={view.playing} press={press} size="slim" sheet="color-mix(in srgb, var(--aerie-surface-strong) 70%, transparent)" />
      </div>
    );
  }
  // One slim line, a pill on the bottom of the cell.
  if (look === 'slim') {
    return (
      <div className="flex h-full items-end">
        <div className="flex w-full items-center gap-2 rounded-full py-1 pl-1.5 pr-1" style={surface}>
          <button type="button" onClick={onOpen} aria-label={`Open Spotify: ${track.name}`} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <Cover src={track.cover} className="h-8 w-8 shrink-0 rounded-full" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
              {track.name}{track.artist && <span className="font-normal" style={{ color: 'var(--aerie-text-muted)' }}> · {track.artist}</span>}
            </span>
          </button>
          <Controls playing={view.playing} press={press} size="slim" sheet="color-mix(in srgb, var(--aerie-text) 10%, transparent)" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full items-center gap-2 rounded-[var(--shape-surface)] px-2.5" style={surface}>
      <button type="button" onClick={onOpen} aria-label={`Open Spotify: ${track.name}`} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Cover src={track.cover} className="h-12 w-12 shrink-0 rounded-lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{track.name}</span>
          {track.artist && <span className="block truncate text-xs" style={{ color: 'var(--aerie-text-muted)' }}>{track.artist}</span>}
        </span>
      </button>
      <Controls playing={view.playing} press={press} size="card" sheet="color-mix(in srgb, var(--aerie-text) 10%, transparent)" />
    </div>
  );
}

function DayWidget() {
  const now = useNow(60_000);
  const t = clockParts(new Date(now));
  const [weekday, ...rest] = t.dateLong.split(', ');
  return (
    <div className="flex h-full items-baseline justify-between gap-3 rounded-[var(--shape-surface)] px-4 py-2" style={surface}>
      <span className="text-3xl">{weekday}</span>
      <span className="text-sm" style={{ color: 'var(--aerie-text-muted)' }}>{rest.join(', ')}</span>
    </div>
  );
}

// How long a widget has to be held before it lifts, and how far a finger can
// wander first; past that it was a swipe, not a hold. The same as the clock.
const HOLD_MS = 450;
const HOLD_SLOP = 10;
// One grid row, and the gap between rows and columns, in pixels. A row is a
// third of the 76px row the widgets were drawn for (ROW_PARTS), so three of
// them and their two gaps still make 76 and a widget keeps its size.
const GAP_PX = 12;
const ROW_PX = (76 - GAP_PX * (ROW_PARTS - 1)) / ROW_PARTS;

interface Lifted { id: HomeWidget; dx: number; dy: number; to: Spot }

/** The widgets switched on, each in its place on a four-wide grid whose rows
 *  count up from the dock (lib/home-widgets.ts). Holding one lifts it; a
 *  dashed box shows where it will land, it lands exactly there, and
 *  anything it covers moves to the nearest open place. */
export function HomeWidgets({
  widgets,
  spots,
  companions,
  customEmojis,
  notePalette,
  themeMode = 'dark',
  clockLook = 'stacked',
  spotifyLook = 'bar',
  weatherLook = 'card',
  onOpenAppId,
  onPlace,
}: {
  widgets: HomeWidget[];
  spots: Layout;
  companions: WidgetCompanion[];
  customEmojis?: import('../types').CustomEmoji[];
  notePalette: string[];
  themeMode?: 'light' | 'dark';
  clockLook?: HomeClockLook;
  spotifyLook?: LockSpotifyLook;
  weatherLook?: HomeWeatherLook;
  onOpenAppId: (id: string) => void;
  onPlace?: (layout: Record<HomeWidget, Spot>) => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const cells = useRef(new Map<HomeWidget, HTMLDivElement>());
  const [lifted, setLifted] = useState<Lifted | null>(null);
  const liftedRef = useRef<Lifted | null>(null);
  // How many rows fit between the dock and the top of the screen, measured
  // when a widget lifts, so one can be carried up into the empty space.
  const [roomRows, setRoomRows] = useState(0);
  const hold = useRef({ timer: 0, id: null as HomeWidget | null, x: 0, y: 0, lastX: 0, lastY: 0, fromX: 0, fromY: 0, grabX: 0, grabY: 0, pointer: -1, dragging: false, droppedAt: 0, rows: 0 });

  const sizes = lookSizes({ spotify: spotifyLook, weather: weatherLook });
  // How many rows fit between the grid's bottom edge (which never moves) and
  // just under the status bar, kept current, so nothing is ever drawn up off
  // the top of the screen.
  const [fitRows, setFitRows] = useState(0);
  // Measured in the home screen's own pixels: while it zooms in on the way
  // back from an app it is drawn scaled, and a scaled measure read as less
  // room than there is, so them note was left out until something re-measured
  // (theirs, Nov 8 2026: coming back home popped the note off).
  const roomFor = (g: HTMLElement) => {
    const home = g.closest<HTMLElement>('[data-home-screen]') ?? g.parentElement;
    const box = home?.getBoundingClientRect();
    const scale = home && box && home.offsetHeight > 0 ? box.height / home.offsetHeight : 1;
    const sat = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0;
    const room = (g.getBoundingClientRect().bottom - (box?.top ?? 0)) / (scale || 1) - (sat + 12);
    return Math.max(0, Math.floor((room + GAP_PX) / (ROW_PX + GAP_PX)));
  };
  useLayoutEffect(() => {
    const g = grid.current;
    if (!g) return;
    // While they are typing (the quiet line's Answer us), the keyboard squashes
    // the screen and the grid rides up with it; that is not less room, so the
    // count only grows until the field lets go (theirs, Nov 10 2026: tapping
    // Answer us told them there was no room for their clock or their note).
    const read = () => setFitRows((prev) => {
      const next = roomFor(g);
      if (next < prev && typingNow()) return prev;
      return next === prev ? prev : next;
    });
    read();
    // And once more after the zoom settles, in case anything else moved.
    const later = window.setTimeout(read, 450);
    window.addEventListener('resize', read);
    // When the field lets go, measure again once the keyboard has gone down.
    const letGo = () => window.setTimeout(read, 350);
    document.addEventListener('focusout', letGo);
    return () => { window.clearTimeout(later); window.removeEventListener('resize', read); document.removeEventListener('focusout', letGo); };
  });
  const { layout, shown, noRoom } = fitWidgets(widgets, spots, sizes, fitRows);
  const show = (next: Lifted | null) => { liftedRef.current = next; setLifted(next); };
  const stopTimer = () => { if (hold.current.timer) { window.clearTimeout(hold.current.timer); hold.current.timer = 0; } };
  useEffect(() => stopTimer, []);

  /** The place the carried widget would land, from where its top-left corner
   *  is under the finger: the nearest column, and the row counted up from the
   *  grid's bottom edge, which never moves. */
  const landing = (id: HomeWidget, clientX: number, clientY: number): Spot => {
    const g = grid.current!.getBoundingClientRect();
    const size = sizeOf(id, sizes);
    const colW = (g.width - GAP_PX * (GRID_COLS - 1)) / GRID_COLS;
    const left = clientX - hold.current.grabX - g.left;
    const bottom = clientY - hold.current.grabY + size.rows * ROW_PX + (size.rows - 1) * GAP_PX;
    const col = Math.round(left / (colW + GAP_PX));
    const row = Math.round((g.bottom - bottom) / (ROW_PX + GAP_PX));
    return {
      col: Math.min(GRID_COLS - size.cols, Math.max(0, col)),
      row: Math.max(0, Math.min(Math.max(0, hold.current.rows - size.rows), row)),
    };
  };

  const handlers = (id: HomeWidget) => onPlace ? {
    onPointerDown: (e: React.PointerEvent) => {
      // A long press inside the reply box selects text, as it always has.
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      const h = hold.current;
      stopTimer();
      h.id = id; h.x = h.lastX = e.clientX; h.y = h.lastY = e.clientY; h.pointer = e.pointerId; h.dragging = false;
      h.timer = window.setTimeout(() => {
        h.timer = 0;
        const el = cells.current.get(id);
        const g = grid.current;
        if (!el || !g) return;
        const box = el.getBoundingClientRect();
        h.grabX = h.lastX - box.left;
        h.grabY = h.lastY - box.top;
        h.fromX = h.lastX; h.fromY = h.lastY;
        // Room from the grid's bottom edge up to the top of the middle of the
        // home screen, in whole rows.
        // Up to just under the status bar (theirs, Nov 8 2026: closer to the
        // top), not only to the bottom of the lock button's row.
        h.rows = Math.max(layoutHeight(layout, sizes), roomFor(g));
        setRoomRows(h.rows);
        h.dragging = true;
        haptic(55);
        try { el.setPointerCapture(h.pointer); } catch { /* the finger already left */ }
        show({ id, dx: 0, dy: 0, to: layout[id] });
      }, HOLD_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const h = hold.current;
      h.lastX = e.clientX; h.lastY = e.clientY;
      if (!h.dragging) {
        if (Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP) stopTimer();
        return;
      }
      show({ id, dx: e.clientX - h.fromX, dy: e.clientY - h.fromY, to: landing(id, e.clientX, e.clientY) });
    },
    onPointerUp: () => {
      stopTimer();
      const h = hold.current;
      if (!h.dragging) return;
      h.dragging = false;
      h.droppedAt = Date.now();
      const to = liftedRef.current?.to ?? null;
      show(null);
      setRoomRows(0);
      const from = layout[id];
      if (to && (to.col !== from.col || to.row !== from.row)) {
        haptic(55);
        onPlace(placeWidget(layout, shown, id, to, h.rows, sizes));
      }
    },
    onPointerCancel: () => {
      stopTimer();
      hold.current.dragging = false;
      show(null);
      setRoomRows(0);
    },
    // Letting go of a carried widget must not open its app as well.
    onClickCapture: (e: React.MouseEvent) => {
      if (Date.now() - hold.current.droppedAt < 400) { e.preventDefault(); e.stopPropagation(); }
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  } : {};

  if (widgets.length === 0) return null;
  const labelOf = (id: HomeWidget) => HOME_WIDGETS.find((w) => w.id === id)!.label;
  // While one is carried the grid reaches up to the top of the room, so the
  // empty space above is somewhere to put it; its bottom edge stays put.
  const height = Math.max(layoutHeight(layout, sizes), lifted ? roomRows : 0);
  const area = (id: HomeWidget, at: Spot): React.CSSProperties => {
    const size = sizeOf(id, sizes);
    return {
      gridColumn: `${at.col + 1} / span ${size.cols}`,
      gridRow: `${height - at.row - size.rows + 1} / span ${size.rows}`,
    };
  };
  return (
    <div
      ref={grid}
      className="aerie-widget-grid relative grid grid-cols-4"
      style={{ gap: GAP_PX, gridTemplateRows: `repeat(${height}, ${ROW_PX}px)` }}
      data-carrying={lifted ? '' : undefined}
    >
      {lifted && (
        <div
          aria-hidden="true"
          style={{ ...area(lifted.id, lifted.to), border: '2px dashed var(--aerie-accent)', borderRadius: 18, background: 'color-mix(in srgb, var(--aerie-accent) 18%, transparent)', position: 'relative', zIndex: 20, pointerEvents: 'none' }}
        />
      )}
      {noRoom.length > 0 && (
        <div
          className="pointer-events-none fixed inset-x-0 flex justify-center px-16"
          style={{ top: 'calc(var(--sat, 0px) + 10px)', zIndex: 40 }}
        >
          <span className="rounded-full px-3 py-1 text-center text-[11px]" style={{ background: 'rgb(0 0 0 / 0.6)', color: '#fff' }}>
          No room for {noRoom.map(labelOf).join(' or ')}. Hold a widget to make space, or turn one off in Settings.
          </span>
        </div>
      )}
      {shown.map((id) => {
        const carried = lifted?.id === id;
        const cell: React.CSSProperties = {
          ...area(id, layout[id]),
          touchAction: onPlace ? 'none' : undefined,
          borderRadius: 18,
          ...(lifted && !carried ? { outline: '1px dashed var(--aerie-hairline)', outlineOffset: 3 } : {}),
          ...(carried ? {
            transform: `translate(${lifted.dx}px, ${lifted.dy}px) scale(1.03)`,
            position: 'relative',
            zIndex: 30,
            boxShadow: '0 14px 30px rgba(0,0,0,0.35)',
          } : {}),
        };
        let body: React.ReactNode = null;
        if (id === 'companions') body = <CompanionsWidget companions={companions} customEmojis={customEmojis} onOpen={() => onOpenAppId('messages')} />;
        if (id === 'note') body = <NoteWidget companions={companions} palette={notePalette} mode={themeMode} onOpen={() => onOpenAppId('notes')} />;
        if (id === 'weather') body = <WeatherWidget onOpen={() => onOpenAppId('weather')} onLight={themeMode === 'light'} look={weatherLook} />;
        if (id === 'letter') body = <LetterWidget companions={companions} onOpen={() => onOpenAppId('letters')} />;
        if (id === 'day') body = <DayWidget />;
        if (id === 'clock') body = <ClockWidget look={clockLook} />;
        if (id === 'music') body = <MusicWidget onOpen={() => onOpenAppId('spotify')} look={spotifyLook} />;
        return (
          <div
            key={id}
            data-widget-cell={id}
            data-label={labelOf(id)}
            ref={(el) => { if (el) cells.current.set(id, el); else cells.current.delete(id); }}
            style={cell}
            {...handlers(id)}
          >
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** One line of the latest reply riding on top of the dock. */
export function QuietLine({ companions, onOpen, scroll = false }: { companions: WidgetCompanion[]; onOpen: () => void; scroll?: boolean }) {
  const { last } = useLatestReply();
  const now = useNow(30_000);
  if (!last) return null;
  const line = replyLines(last.content, 2).find((l) => !l.action) ?? replyLines(last.content, 1)[0];
  if (!line) return null;
  return (
    <button type="button" onClick={onOpen} className="aerie-quiet-line flex w-full items-center gap-2 rounded-[var(--shape-surface)] px-3 py-2 text-left" style={surface}>
      <Faces companions={companions} size={18} />
      {scroll
        ? <Ticker className="flex-1 text-xs">{line.text}</Ticker>
        : <span className="min-w-0 flex-1 truncate text-xs">{line.text}</span>}
      <span className="text-[10px]" style={{ color: 'var(--aerie-text-muted)' }}>{ageLabel(Date.parse(last.created_at), now)}</span>
    </button>
  );
}

/** The sheet a long press on the home screen opens: every widget, on or off. */
export function WidgetSheet({
  widgets,
  quietLine,
  onToggle,
  onQuietLine,
  onClose,
  clockLook = 'stacked',
  onClockLook,
  spotifyLook = 'bar',
  onSpotifyLook,
  weatherLook = 'card',
  onWeatherLook,
}: {
  widgets: HomeWidget[];
  quietLine: boolean;
  clockLook?: HomeClockLook;
  onClockLook?: (look: HomeClockLook) => void;
  spotifyLook?: LockSpotifyLook;
  onSpotifyLook?: (look: LockSpotifyLook) => void;
  weatherLook?: HomeWeatherLook;
  onWeatherLook?: (look: HomeWeatherLook) => void;
  onToggle: (id: HomeWidget) => void;
  onQuietLine: (on: boolean) => void;
  onClose: () => void;
}) {
  const row = (on: boolean): React.CSSProperties => on
    ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)', border: '1px solid transparent' }
    : { background: 'var(--aerie-surface-strong)', color: 'var(--aerie-text)', border: '1px solid var(--aerie-hairline)' };
  return (
    <div className="absolute inset-0 z-50 flex items-end" onClick={onClose} style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div
        className="max-h-[85vh] w-full space-y-2 overflow-y-auto overscroll-contain rounded-t-3xl p-4"
        style={{ background: 'var(--aerie-surface-strong)', color: 'var(--aerie-text)', paddingBottom: 'calc(var(--sab, 0px) + 1rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full" style={{ background: 'var(--aerie-hairline)' }} />
        <p className="text-sm font-semibold">Widgets</p>
        <p className="text-[11px] opacity-75">Hold a widget on your home screen to move it.</p>
        {HOME_WIDGETS.map((w) => {
          const on = widgets.includes(w.id);
          // Each widget's looks sit right under it, once it is on (theirs, Nov 9
          // 2026: 'not all in one block under Spotify').
          const looks: React.ReactNode =
            !on ? null
            : w.id === 'music' && onSpotifyLook ? (
              <div className="grid grid-cols-3 gap-1.5 px-1">
                {([['bar', 'Bar'], ['cover', 'Record'], ['slim', 'Slim']] as [LockSpotifyLook, string][]).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => onSpotifyLook(id)} className="rounded-xl px-2 py-1.5 text-[11px] font-semibold" style={row(spotifyLook === id)} aria-pressed={spotifyLook === id}>
                    {label}
                  </button>
                ))}
              </div>
            )
            : w.id === 'weather' && onWeatherLook ? (
              <div className="grid grid-cols-4 gap-1.5 px-1">
                {HOME_WEATHER_LOOKS.map((look) => (
                  <button key={look} type="button" onClick={() => onWeatherLook(look)} className="rounded-xl px-2 py-1.5 text-[11px] font-semibold capitalize" style={row(weatherLook === look)} aria-pressed={weatherLook === look}>
                    {look}
                  </button>
                ))}
              </div>
            )
            : w.id === 'clock' && onClockLook ? (
              <div className="grid grid-cols-4 gap-1.5 px-1">
                {HOME_CLOCK_LOOKS.map((look) => (
                  <button key={look} type="button" onClick={() => onClockLook(look)} className="rounded-xl px-2 py-1.5 text-[11px] font-semibold capitalize" style={row(clockLook === look)} aria-pressed={clockLook === look}>
                    {look}
                  </button>
                ))}
              </div>
            )
            : null;
          return (
            <React.Fragment key={w.id}>
              <button type="button" onClick={() => onToggle(w.id)} className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left" style={row(on)}>
                <span className="flex flex-col">
                  <span className="text-sm font-semibold">{w.label}</span>
                  <span className="text-[11px] opacity-75">{w.hint}</span>
                </span>
                <span className="text-[11px] font-bold tracking-widest">{sizeLabel(w)}</span>
              </button>
              {looks}
            </React.Fragment>
          );
        })}
        <button type="button" onClick={() => onQuietLine(!quietLine)} className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left" style={row(quietLine)}>
          <span className="flex flex-col">
            <span className="text-sm font-semibold">Quiet line</span>
            <span className="text-[11px] opacity-75">One line of the latest reply, riding on the dock</span>
          </span>
        </button>
      </div>
    </div>
  );
}
