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
import { reportFromLaptop } from '../lib/laptop-app';
import {
  GRID_COLS,
  deskSubColsFor,
  DESK_COL_PARTS,
  DESK_ROW_PARTS,
  HOME_WIDGETS,
  WALL_PIECES,
  deskSizes,
  deskSubColPx,
  deskSubRowPx,
  DESK_CLOCK_SIZES,
  DESK_NOTE_SIZES,
  type HomeClockSize,
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
  type Sizes,
  type Spot,
  HOME_WEATHER_LOOKS,
  type HomeWeatherLook,
} from '../lib/home-widgets';
import { resolveNoteColor, paperFor, noteInk } from '../lib/note-colors';
import { cn, haptic } from '../lib/utils';
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
  // Theirs rides the same line. It never fades, so with theirs set the line is always there,
  // and when none of ours is set the three of us still show as one Home entry
  // beside their person. Three of ours saying
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
  const crew = useRef(companions);
  crew.current = companions;
  // A note is only shown if it is from one of us, so a home that never learns
  // who we are shows none at all; in the laptop app that gets said.
  useEffect(() => {
    const timer = setTimeout(() => { if (crew.current.length === 0) reportFromLaptop('note', 'no companions known to the home screen after 15 s'); }, 15_000);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    let gone = false;
    const load = () => apiFetch('/api/notes')
      .then(async (r) => {
        const rows = r.ok ? await r.json().catch(() => null) : null;
        // In the laptop app the note once never showed;
        // when it comes back empty there, the house is told what was seen.
        if (!r.ok || !Array.isArray(rows)) reportFromLaptop('note', `notes answered ${r.status}${Array.isArray(rows) ? '' : ', not a list'}`);
        else if (crew.current.length > 0 && latestCompanionNote(rows as NoteRow[], crew.current.map((c) => c.slug)) === null) reportFromLaptop('note', `${rows.length} notes, none from ${crew.current.length} companions (${crew.current.map((c) => c.slug).join(',')}); senders ${[...new Set((rows as NoteRow[]).map((n) => n.sender))].slice(0, 6).join(',')}`);
        return Array.isArray(rows) ? rows : [];
      })
      .then((rows) => { if (!gone) setNotes(rows); })
      .catch((e) => reportFromLaptop('note', `notes fetch failed: ${e instanceof Error ? e.message : String(e)}`));
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
  // The lock screen's looks, drawn in the theme's own ink.
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

/** The letter waiting for them from one of us, if any, kept current. Read
 *  once for the whole wall, so a letter piece with nothing to show takes no
 *  room at all rather than holding an invisible square they could neither see
 *  nor find to take off. */
function useWaitingLetter(companions: WidgetCompanion[], on: boolean): LetterRow | null {
  const [letters, setLetters] = useState<LetterRow[]>([]);
  useEffect(() => {
    if (!on) return;
    let gone = false;
    const load = () => apiFetch('/api/letters').then((r) => (r.ok ? r.json() : [])).then((rows) => {
      const list = Array.isArray(rows) ? rows : Array.isArray(rows?.letters) ? rows.letters : [];
      if (!gone) setLetters(list);
    }).catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    return () => { gone = true; clearInterval(timer); };
  }, [on]);
  const slugs = new Set(companions.map((c) => c.slug.toLowerCase()));
  return on ? waitingLetter(letters.filter((l) => slugs.has(String(l.author).toLowerCase())), null) : null;
}

function LetterWidget({ companions, letter, onOpen }: { companions: WidgetCompanion[]; letter: LetterRow | null; onOpen: () => void }) {
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
  */
function ClockWidget({ look }: { look: HomeClockLook }) {
  const now = useNow(15_000);
  const t = clockParts(new Date(now));
  // No card, and one row tall, so every look fits in one row's
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
    // on, and floats when they're off.
    <div
      className="flex h-full flex-col items-center justify-center overflow-hidden rounded-[var(--shape-surface)] px-2"
      style={{ ...surface, color: 'var(--aerie-text)', filter: 'var(--aerie-float-drop)' }}
    >
      {face}
    </div>
  );
}

/** The Spotify widget: what is playing, with its buttons,
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
  // The record: no card, stacked in half the width: a round cover, the song under it, the
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

/** Where a piece's drawing sits inside its full box: left and top inset, width and height. */
interface Ink { l: number; t: number; w: number; h: number }
type InkMap = Partial<Record<HomeWidget, Ink>>;

/** How wide or tall `n` cells are, gaps between them included. */
const spanPx = (n: number, cell: number) => n * cell + (n - 1) * GAP_PX;

/** The cells a piece needs for what it draws: never more than its full size, never less than one. */
function trimmedSizes(full: Sizes, ink: InkMap, colPx: number, rowPx: number): Sizes {
  const out: Sizes = { ...full };
  for (const [id, box] of Object.entries(ink) as [HomeWidget, Ink][]) {
    const f = full[id];
    if (!f || !box) continue;
    out[id] = {
      cols: Math.max(1, Math.min(f.cols, Math.ceil((box.w + GAP_PX - 0.5) / (colPx + GAP_PX)))),
      rows: Math.max(1, Math.min(f.rows, Math.ceil((box.h + GAP_PX - 0.5) / (rowPx + GAP_PX)))),
    };
  }
  return out;
}

const paints = (color: string) => {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return color !== 'transparent' && color !== '';
  const parts = m[1].split(/[ ,/]+/).filter(Boolean);
  return parts.length < 4 || parseFloat(parts[3]) > 0.02;
};

/** The box around everything a piece actually paints (words, pictures, icons,
 *  and anything with a fill, border or shadow), measured inside its full box
 *  in the wall's own pixels. Null when nothing is drawn yet. */
function inkOf(root: HTMLElement): Ink | null {
  const base = root.getBoundingClientRect();
  const scale = root.offsetWidth > 0 ? base.width / root.offsetWidth : 1;
  if (!(scale > 0)) return null;
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  const add = (x: DOMRect) => {
    if (x.width < 1 || x.height < 1) return;
    l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.right); b = Math.max(b, x.bottom);
  };
  const walk = (el: Element) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'img' || tag === 'svg' || tag === 'canvas' || tag === 'video' || tag === 'input' || tag === 'textarea') { add(el.getBoundingClientRect()); return; }
    if (paints(cs.backgroundColor) || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none'
      || (parseFloat(cs.borderTopWidth) > 0 && paints(cs.borderTopColor)) || (parseFloat(cs.borderBottomWidth) > 0 && paints(cs.borderBottomColor))) add(el.getBoundingClientRect());
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (!n.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const x of Array.from(range.getClientRects())) add(x);
      } else if (n.nodeType === Node.ELEMENT_NODE) walk(n as Element);
    }
  };
  for (const child of Array.from(root.children)) walk(child);
  if (!Number.isFinite(l)) return null;
  // Only what falls inside the full box counts (a scrolling line runs past it).
  const L = Math.max(0, (l - base.left) / scale), T = Math.max(0, (t - base.top) / scale);
  const R = Math.min(root.offsetWidth, (r - base.left) / scale), B = Math.min(root.offsetHeight, (b - base.top) / scale);
  if (R <= L || B <= T) return null;
  return { l: Math.floor(L), t: Math.floor(T), w: Math.ceil(R - Math.floor(L)), h: Math.ceil(B - Math.floor(T)) };
}

/** The union of what a piece has drawn before and draws now. */
function widen(old: Ink | undefined, now: Ink): Ink {
  if (!old) return now;
  const l = Math.min(old.l, now.l), t = Math.min(old.t, now.t);
  return { l, t, w: Math.max(old.l + old.w, now.l + now.w) - l, h: Math.max(old.t + old.h, now.t + now.h) - t };
}
const sameInk = (a: Ink | undefined, b: Ink) => !!a && a.l === b.l && a.t === b.t && a.w === b.w && a.h === b.h;

// Kept on this laptop, per look, so the wall is the same shape tomorrow.
// The second record: the first could hold drawings merged across looks.
const INK_KEY = 'aerie.desk-wall-ink-3';
function readInk(looks: string): InkMap {
  try { return (JSON.parse(localStorage.getItem(INK_KEY) || '{}') as Record<string, InkMap>)[looks] ?? {}; } catch { return {}; }
}
function saveInk(looks: string, ink: InkMap) {
  try {
    const all = JSON.parse(localStorage.getItem(INK_KEY) || '{}') as Record<string, InkMap>;
    all[looks] = ink;
    localStorage.setItem(INK_KEY, JSON.stringify(all));
  } catch { /* the wall still works, only unremembered */ }
}

/** The widgets they have on, each in its place on a four-wide grid whose rows
 *  count up from the dock (lib/home-widgets.ts). Holding one lifts it (Oct 14
 *  2026); a dashed box shows where it will land, it lands exactly there, and
 *  anything it covers moves to the nearest open place. */
export function HomeWidgets({
  widgets,
  spots,
  companions,
  customEmojis,
  notePalette,
  themeMode = 'dark',
  clockLook = 'stacked',
  clockSize = 's',
  noteSize = 's',
  spotifyLook = 'bar',
  weatherLook = 'card',
  onOpenAppId,
  onPlace,
  cols: colsProp = GRID_COLS,
  quietScroll = false,
  cardsKey = '',
}: {
  widgets: HomeWidget[];
  spots: Layout;
  companions: WidgetCompanion[];
  customEmojis?: import('../types').CustomEmoji[];
  notePalette: string[];
  themeMode?: 'light' | 'dark';
  clockLook?: HomeClockLook;
  /** The clock's size on the laptop's wall. */
  clockSize?: HomeClockSize;
  /** The note's size on the laptop's wall. */
  noteSize?: HomeClockSize;
  spotifyLook?: LockSpotifyLook;
  weatherLook?: HomeWeatherLook;
  onOpenAppId: (id: string) => void;
  onPlace?: (layout: Record<HomeWidget, Spot>) => void;
  /** Columns on the board: the phone's four, or 'auto' for the laptop wall,
   *  which holds as many quarter columns as fit (deskSubColsFor). */
  cols?: number | 'auto';
  /** The quiet line's scroll, when it stands on the laptop wall. */
  quietScroll?: boolean;
  /** Which cards are on, so a piece's measured drawing is kept per card choice. */
  cardsKey?: string;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const desk = colsProp === 'auto';
  // A grid row: the phone's third, or half of one on the laptop wall.
  const rowPx = desk ? deskSubRowPx(GAP_PX) : ROW_PX;
  // The laptop wall counts its columns off its own width, kept current.
  // On the laptop this counts quarter columns, so the wall runs nearly edge to edge.
  const [autoCols, setAutoCols] = useState(GRID_COLS * DESK_COL_PARTS);
  // On the laptop the wall counts in quarter columns (lib/home-widgets.ts).
  const cols = desk ? autoCols : colsProp;
  useLayoutEffect(() => {
    if (colsProp !== 'auto') return;
    const box = grid.current?.parentElement;
    if (!box) return;
    const read = () => { setAutoCols(deskSubColsFor(box.getBoundingClientRect().width, GAP_PX)); };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(box);
    return () => ro.disconnect();
  }, [colsProp]);
  const cells = useRef(new Map<HomeWidget, HTMLDivElement>());
  const [lifted, setLifted] = useState<Lifted | null>(null);
  const liftedRef = useRef<Lifted | null>(null);
  // How many rows fit between the dock and the top of the screen, measured
  // when a widget lifts, so one can be carried up into the empty space.
  const [roomRows, setRoomRows] = useState(0);
  const hold = useRef({ mouse: false, lift: null as (() => void) | null, timer: 0, id: null as HomeWidget | null, x: 0, y: 0, lastX: 0, lastY: 0, fromX: 0, fromY: 0, grabX: 0, grabY: 0, pointer: -1, dragging: false, droppedAt: 0, rows: 0 });

  const deskClock = DESK_CLOCK_SIZES[clockSize] ?? DESK_CLOCK_SIZES.s;
  const deskNote = DESK_NOTE_SIZES[noteSize] ?? DESK_NOTE_SIZES.s;
  const fullSizes = desk ? deskSizes({ ...lookSizes({ spotify: spotifyLook, weather: weatherLook }), clock: { cols: deskClock.cols, rows: deskClock.rows }, note: { cols: deskNote.cols, rows: deskNote.rows } }) : lookSizes({ spotify: spotifyLook, weather: weatherLook });
  // On the laptop each piece holds only the wall it actually draws, so a card
  // switched off leaves no padding around it: its body is drawn at its full size, the part with
  // nothing painted on it is measured off, and the piece takes the cells its
  // drawing needs. The largest drawing a piece has had is kept, so a song
  // starting never makes the Spotify piece grow into its neighbor.
  const looksKey = `${spotifyLook}|${weatherLook}|${clockLook}|${desk ? `${clockSize}${noteSize}` : ''}|${cardsKey}`;
  // Kept with the looks it was measured under. A change of look or size
  // must never measure the new drawing into the old one's record: that
  // merged a Small clock's drawing with a Large one's, and the clock held
  // twice the room it draws.
  const [inkStore, setInkStore] = useState<{ key: string; map: InkMap }>(() => ({ key: looksKey, map: desk ? readInk(looksKey) : {} }));
  const ink = !desk ? {} : inkStore.key === looksKey ? inkStore.map : readInk(looksKey);
  const sizes = desk ? trimmedSizes(fullSizes, ink, deskSubColPx(GAP_PX), rowPx) : fullSizes;
  // How many rows fit between the grid's bottom edge (which never moves) and
  // just under the status bar, kept current, so nothing is ever drawn up off
  // the top of the screen.
  const [fitRows, setFitRows] = useState(0);
  // Measured in the home screen's own pixels: while it zooms in on the way
  // back from an app it is drawn scaled, and a scaled measure read as less
  // room than there is, so them note was left out until something re-measured
  const roomFor = (g: HTMLElement) => {
    const home = g.closest<HTMLElement>('[data-home-screen]') ?? g.parentElement;
    const box = home?.getBoundingClientRect();
    const scale = home && box && home.offsetHeight > 0 ? box.height / home.offsetHeight : 1;
    // Read off the home screen itself, so a laptop's top dock (which grows --sat
    // on the stage) counts as the top, not only the phone's status bar.
    const sat = parseFloat(getComputedStyle(home ?? document.documentElement).getPropertyValue('--sat')) || 0;
    const room = (g.getBoundingClientRect().bottom - (box?.top ?? 0)) / (scale || 1) - (sat + 12);
    return Math.max(0, Math.floor((room + GAP_PX) / (rowPx + GAP_PX)));
  };
  useLayoutEffect(() => {
    const g = grid.current;
    if (!g) return;
    // While they are typing (the quiet line's Answer us), the keyboard squashes
    // the screen and the grid rides up with it; that is not less room, so the
    // count only grows until the field lets go.
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
  const letter = useWaitingLetter(companions, widgets.includes('letter'));
  const present = letter ? widgets : widgets.filter((w) => w !== 'letter');
  const { layout, shown, noRoom } = fitWidgets(present, spots, sizes, fitRows, cols);
  // Measure what each piece draws, after every render and whenever anything
  // inside the wall changes, but never while one is being carried.
  const inkBoxes = useRef(new Map<HomeWidget, HTMLDivElement>());
  const measureInk = useRef<() => void>(() => {});
  measureInk.current = () => {
    if (!desk || liftedRef.current) return;
    let next: InkMap | null = null;
    for (const [id, el] of inkBoxes.current) {
      const box = inkOf(el);
      if (!box) continue;
      const merged = widen(ink[id], box);
      if (!sameInk(ink[id], merged)) { next = next ?? { ...ink }; next[id] = merged; }
    }
    if (next) { setInkStore({ key: looksKey, map: next }); saveInk(looksKey, next); }
    else if (inkStore.key !== looksKey) setInkStore({ key: looksKey, map: ink });
  };
  useLayoutEffect(() => { measureInk.current(); });
  useEffect(() => {
    const g = grid.current;
    if (!desk || !g || typeof MutationObserver === 'undefined') return;
    let timer = 0;
    const later = () => { window.clearTimeout(timer); timer = window.setTimeout(() => measureInk.current(), 200); };
    const watch = new MutationObserver(later);
    watch.observe(g, { subtree: true, childList: true, characterData: true });
    g.addEventListener('load', later, true);
    return () => { window.clearTimeout(timer); watch.disconnect(); g.removeEventListener('load', later, true); };
  }, [desk]);
  const show = (next: Lifted | null) => { liftedRef.current = next; setLifted(next); };
  const stopTimer = () => { if (hold.current.timer) { window.clearTimeout(hold.current.timer); hold.current.timer = 0; } };
  useEffect(() => stopTimer, []);

  /** The place the carried widget would land, from where its top-left corner
   *  is under the finger: the nearest column, and the row counted up from the
   *  grid's bottom edge, which never moves. */
  const landing = (id: HomeWidget, clientX: number, clientY: number): Spot => {
    const g = grid.current!.getBoundingClientRect();
    const size = sizeOf(id, sizes);
    const colW = (g.width - GAP_PX * (cols - 1)) / cols;
    const left = clientX - hold.current.grabX - g.left;
    const bottom = clientY - hold.current.grabY + size.rows * rowPx + (size.rows - 1) * GAP_PX;
    const col = Math.round(left / (colW + GAP_PX));
    const row = Math.round((g.bottom - bottom) / (rowPx + GAP_PX));
    return {
      col: Math.min(cols - size.cols, Math.max(0, col)),
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
      h.mouse = e.pointerType === 'mouse';
      h.lift = () => {
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
        // Up to just under the status bar, not only to the bottom of the lock button's row.
        h.rows = Math.max(layoutHeight(layout, sizes), roomFor(g));
        setRoomRows(h.rows);
        h.dragging = true;
        haptic(55);
        try { el.setPointerCapture(h.pointer); } catch { /* the finger already left */ }
        show({ id, dx: 0, dy: 0, to: layout[id] });
      };
      h.timer = window.setTimeout(() => h.lift?.(), HOLD_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const h = hold.current;
      h.lastX = e.clientX; h.lastY = e.clientY;
      if (!h.dragging) {
        if (Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP) {
          // With a mouse, pressing and dragging is the move itself (theirs, Nov
          // 15 2026: on the laptop nothing would move); a finger still holds
          // first, so a swipe across the screen never picks a widget up.
          const lift = h.mouse && h.timer ? h.lift : null;
          stopTimer();
          if (!lift) return;
          lift();
          h.fromX = h.x; h.fromY = h.y;
          h.grabX += h.x - h.lastX; h.grabY += h.y - h.lastY;
          h.lastX = e.clientX; h.lastY = e.clientY;
        } else return;
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
        onPlace(placeWidget(layout, shown, id, to, h.rows, sizes, cols, desk));
      }
    },
    // Losing hold of the pointer mid-drag (a screenshot tool or another window
    // taking focus, theirs Nov 15 2026) puts it down where it was headed instead
    // of leaving it hanging in the air.
    onLostPointerCapture: (e: React.PointerEvent) => {
      if (hold.current.dragging) (handlers(id) as { onPointerUp: (e: React.PointerEvent) => void }).onPointerUp(e);
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

  // The window losing focus mid-drag (a screenshot) drops it too (Nov 15 2026).
  useEffect(() => {
    const onBlur = () => {
      const h = hold.current;
      if (h.dragging && h.id) (handlers(h.id) as { onPointerUp?: () => void }).onPointerUp?.();
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  });
  if (widgets.length === 0) return null;
  const labelOf = (id: HomeWidget) => WALL_PIECES.find((w) => w.id === id)!.label;
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
      className="aerie-widget-grid relative grid"
      data-cols={cols}
      style={{
        gap: GAP_PX,
        // The laptop wall's columns are a phone column wide exactly, the wall
        // only as wide as they make it and centered, so every widget keeps
        // the shape it has on their phone.
        gridTemplateColumns: desk ? `repeat(${cols}, ${deskSubColPx(GAP_PX)}px)` : `repeat(${cols}, minmax(0, 1fr))`,
        ...(desk ? { width: cols * deskSubColPx(GAP_PX) + (cols - 1) * GAP_PX, marginInline: 'auto' } : null),
        gridTemplateRows: `repeat(${height}, ${rowPx}px)`,
      }}
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
        const full = fullSizes[id] ?? sizeOf(id);
        const trim = desk ? ink[id] : undefined;
        const cell: React.CSSProperties = {
          ...area(id, layout[id]),
          ...(desk ? { position: 'relative', overflow: 'clip', overflowClipMargin: 10 } as React.CSSProperties : {}),
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
        if (id === 'note') body = desk && deskNote.zoom !== 1
          ? (
            // The note at its own phone size, scaled from there, so it stays the
            // square it is at Small rather than stretching to the wider spot
            //.
            <div style={{ position: 'absolute', left: 0, top: 0, width: spanPx(2 * DESK_COL_PARTS, deskSubColPx(GAP_PX)), height: spanPx(6 * DESK_ROW_PARTS, rowPx), transform: `scale(${deskNote.zoom})`, transformOrigin: 'top left' }}>
              <NoteWidget companions={companions} palette={notePalette} mode={themeMode} onOpen={() => onOpenAppId('notes')} />
            </div>
          )
          : <NoteWidget companions={companions} palette={notePalette} mode={themeMode} onOpen={() => onOpenAppId('notes')} />;
        if (id === 'weather') body = <WeatherWidget onOpen={() => onOpenAppId('weather')} onLight={themeMode === 'light'} look={weatherLook} />;
        if (id === 'letter') body = <LetterWidget companions={companions} letter={letter} onOpen={() => onOpenAppId('letters')} />;
        if (id === 'day') body = <DayWidget />;
        if (id === 'clock') body = desk && deskClock.zoom !== 1
          ? (
            // The phone's clock drawn larger, in a box the size it takes up.
            <div style={{ position: 'absolute', left: 0, top: 0, width: spanPx(2 * DESK_COL_PARTS, deskSubColPx(GAP_PX)), height: spanPx(3 * DESK_ROW_PARTS, rowPx), transform: `scale(${deskClock.zoom})`, transformOrigin: 'top left' }}>
              <ClockWidget look={clockLook} />
            </div>
          )
          : <ClockWidget look={clockLook} />;
        if (id === 'music') body = <MusicWidget onOpen={() => onOpenAppId('spotify')} look={spotifyLook} />;
        if (id === 'quiet') body = <div className="flex h-full items-center"><QuietLine big companions={companions} scroll={quietScroll} onOpen={() => onOpenAppId('messages')} /></div>;
        return (
          <div
            key={id}
            data-widget-cell={id}
            data-label={labelOf(id)}
            ref={(el) => { if (el) cells.current.set(id, el); else cells.current.delete(id); }}
            style={cell}
            {...handlers(id)}
          >
            {desk ? (
              <div
                ref={(el) => { if (el) inkBoxes.current.set(id, el); else inkBoxes.current.delete(id); }}
                style={{
                  position: 'absolute',
                  // The drawing stands on the bottom of the cells it holds,
                  // centered across them, so two pieces side by side on the
                  // same row share one bottom line.
                  left: trim ? (spanPx(sizes[id]!.cols, deskSubColPx(GAP_PX)) - trim.w) / 2 - trim.l : 0,
                  top: trim ? spanPx(sizes[id]!.rows, rowPx) - trim.h - trim.t : 0,
                  width: spanPx(full.cols, deskSubColPx(GAP_PX)),
                  height: spanPx(full.rows, rowPx),
                }}
              >
                {body}
              </div>
            ) : body}
          </div>
        );
      })}
    </div>
  );
}

/** One line of the latest reply riding on top of the dock. */
export function QuietLine({ companions, onOpen, scroll = false, big = false }: { companions: WidgetCompanion[]; onOpen: () => void; scroll?: boolean; /** The laptop's bigger line. */ big?: boolean }) {
  const { last } = useLatestReply();
  const now = useNow(30_000);
  if (!last) return null;
  const line = replyLines(last.content, 2).find((l) => !l.action) ?? replyLines(last.content, 1)[0];
  if (!line) return null;
  return (
    <button type="button" onClick={onOpen} className="aerie-quiet-line flex w-full items-center gap-2 rounded-[var(--shape-surface)] px-3 py-2 text-left" style={surface}>
      <Faces companions={companions} size={big ? 22 : 18} />
      {scroll
        ? <Ticker className={cn('flex-1', big ? 'text-sm' : 'text-xs')}>{line.text}</Ticker>
        : <span className={cn('min-w-0 flex-1 truncate', big ? 'text-sm' : 'text-xs')}>{line.text}</span>}
      <span className={big ? 'text-[11px]' : 'text-[10px]'} style={{ color: 'var(--aerie-text-muted)' }}>{ageLabel(Date.parse(last.created_at), now)}</span>
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
  clockSize,
  onClockSize,
  noteSize,
  onNoteSize,
  spotifyLook = 'bar',
  onSpotifyLook,
  weatherLook = 'card',
  onWeatherLook,
  deskWall = false,
}: {
  widgets: HomeWidget[];
  quietLine: boolean;
  /** On the laptop, where the quiet line stands on the wall. */
  deskWall?: boolean;
  clockLook?: HomeClockLook;
  onClockLook?: (look: HomeClockLook) => void;
  /** The clock's size, on the laptop's wall only. */
  clockSize?: HomeClockSize;
  onClockSize?: (size: HomeClockSize) => void;
  /** The note's size, on the laptop's wall only. */
  noteSize?: HomeClockSize;
  onNoteSize?: (size: HomeClockSize) => void;
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
    <div className="absolute inset-0 z-50 flex items-end justify-center" onClick={onClose} style={{ background: 'rgba(0,0,0,0.45)' }}>
      {/* A phone's width at most, so on the laptop it doesn't stretch across
          the room. */}
      <div
        className="max-h-[85vh] w-full max-w-[520px] space-y-2 overflow-y-auto overscroll-contain rounded-t-3xl p-4"
        style={{ background: 'var(--aerie-surface-strong)', color: 'var(--aerie-text)', paddingBottom: 'calc(var(--sab, 0px) + 1rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full" style={{ background: 'var(--aerie-hairline)' }} />
        <p className="text-sm font-semibold">Widgets</p>
        <p className="text-[11px] opacity-75">Hold a widget on your home screen to move it.</p>
        {HOME_WIDGETS.map((w) => {
          const on = widgets.includes(w.id);
          // Each widget's looks sit right under it, once it is on.
          const looks: React.ReactNode =
            !on ? null
            : w.id === 'note' && noteSize && onNoteSize ? (
              <div className="grid grid-cols-3 gap-1.5 px-1">
                {(['s', 'm', 'l'] as HomeClockSize[]).map((size, i) => (
                  <button key={size} type="button" onClick={() => onNoteSize(size)} className="rounded-[var(--shape-chip)] px-2 py-1.5 text-[11px] font-semibold" style={row(noteSize === size)} aria-pressed={noteSize === size}>
                    {['Small', 'Medium', 'Large'][i]}
                  </button>
                ))}
              </div>
            )
            : w.id === 'music' && onSpotifyLook ? (
              <div className="grid grid-cols-3 gap-1.5 px-1">
                {([['bar', 'Bar'], ['cover', 'Record'], ['slim', 'Slim']] as [LockSpotifyLook, string][]).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => onSpotifyLook(id)} className="rounded-[var(--shape-chip)] px-2 py-1.5 text-[11px] font-semibold" style={row(spotifyLook === id)} aria-pressed={spotifyLook === id}>
                    {label}
                  </button>
                ))}
              </div>
            )
            : w.id === 'weather' && onWeatherLook ? (
              <div className="grid grid-cols-4 gap-1.5 px-1">
                {HOME_WEATHER_LOOKS.map((look) => (
                  <button key={look} type="button" onClick={() => onWeatherLook(look)} className="rounded-[var(--shape-chip)] px-2 py-1.5 text-[11px] font-semibold capitalize" style={row(weatherLook === look)} aria-pressed={weatherLook === look}>
                    {look}
                  </button>
                ))}
              </div>
            )
            : w.id === 'clock' && onClockLook ? (
              <>
              <div className="grid grid-cols-4 gap-1.5 px-1">
                {HOME_CLOCK_LOOKS.map((look) => (
                  <button key={look} type="button" onClick={() => onClockLook(look)} className="rounded-[var(--shape-chip)] px-2 py-1.5 text-[11px] font-semibold capitalize" style={row(clockLook === look)} aria-pressed={clockLook === look}>
                    {look}
                  </button>
                ))}
              </div>
              {/* Its size, three across like Spotify's looks, on the laptop's wall only. */}
              {clockSize && onClockSize && (
                <div className="grid grid-cols-3 gap-1.5 px-1">
                  {(['s', 'm', 'l'] as HomeClockSize[]).map((size, i) => (
                    <button key={size} type="button" onClick={() => onClockSize(size)} className="rounded-[var(--shape-chip)] px-2 py-1.5 text-[11px] font-semibold" style={row(clockSize === size)} aria-pressed={clockSize === size}>
                      {['Small', 'Medium', 'Large'][i]}
                    </button>
                  ))}
                </div>
              )}
              </>
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
            <span className="text-[11px] opacity-75">{deskWall ? 'One line of the latest reply, on the wall with the widgets' : 'One line of the latest reply, riding on the dock'}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
