// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The home screen's widgets: they sit low in the empty middle so the
// wallpaper keeps the top of the screen, on the same solid surface as the
// dock, because every surface in the house is solid. lib/home-widgets.ts
// decides what each one shows.
import React, { useEffect, useRef, useState } from 'react';
import { Heart, Mail } from 'lucide-react';
import { apiFetch, sendUserMessageToThread, useAerie } from '../aerie';
import { ageLabel, clockParts } from '../lib/lock-clock';
import {
  GRID_COLS,
  HOME_WIDGETS,
  latestCompanionNote,
  layoutHeight,
  layoutWidgets,
  placeWidget,
  replyLines,
  skyWord,
  waitingLetter,
  type HomeWidget,
  type Layout,
  type Spot,
} from '../lib/home-widgets';
import { inkFor, resolveNoteColor } from '../lib/note-colors';
import { haptic } from '../lib/utils';
import { weatherIcon } from './LockClock';
import { useWeather } from './useWeather';

export interface WidgetCompanion {
  slug: string;
  name: string;
  avatar: string | null;
  color: string | null;
}

const surface: React.CSSProperties = {
  background: 'var(--aerie-surface)',
  border: '1px solid var(--aerie-hairline)',
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

function CompanionsWidget({ companions, onOpen }: { companions: WidgetCompanion[]; onOpen: () => void }) {
  const { thread, last } = useLatestReply();
  const now = useNow(30_000);
  const [draft, setDraft] = useState('');
  const lines = last ? replyLines(last.content, 2) : [];
  const send = () => {
    const text = draft.trim();
    if (!text || !thread) return;
    sendUserMessageToThread(thread.id, text);
    haptic(55);
    setDraft('');
  };
  return (
    <div className="flex h-full flex-col gap-2 rounded-2xl p-3" style={surface}>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 flex-col gap-1 text-left">
        <span className="flex items-center gap-2">
          <Faces companions={companions} size={24} />
          <span className="min-w-0 flex-1 truncate text-base font-semibold">{thread?.name || 'Messages'}</span>
          {last && <span className="text-[11px]" style={{ color: 'var(--aerie-text-muted)' }}>{ageLabel(Date.parse(last.created_at), now)}</span>}
        </span>
        {lines.length > 0 ? lines.map((l, i) => (
          <span
            key={i}
            className={l.action ? 'truncate text-xs italic' : 'line-clamp-2 text-sm'}
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

function NoteWidget({ companions, palette, onOpen }: { companions: WidgetCompanion[]; palette: string[]; onOpen: () => void }) {
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
      <button type="button" onClick={onOpen} className="flex h-full items-center justify-center rounded-2xl p-3 text-center text-xs" style={{ ...surface, color: 'var(--aerie-text-muted)' }}>
        No note on the fridge yet.
      </button>
    );
  }
  const paint = resolveNoteColor(note.color, palette) || palette[0] || '#FDE68A';
  const writer = companions.find((c) => c.slug.toLowerCase() === (note.sender || '').toLowerCase());
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full w-full flex-col justify-between p-3 text-left shadow-lg"
      style={{ background: paint, color: inkFor(paint), transform: 'rotate(-2.5deg)', borderRadius: 6, fontFamily: "'Caveat', 'Segoe Print', 'Bradley Hand', cursive" }}
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

function WeatherWidget({ onOpen }: { onOpen: () => void }) {
  const weather = useWeather();
  return (
    <button type="button" onClick={onOpen} className="flex h-full items-center gap-3 rounded-2xl px-3 text-left" style={surface}>
      {weather ? weatherIcon(weather.code) : null}
      <span className="flex flex-col">
        <span className="text-2xl leading-none">{weather ? `${weather.temp}°` : '—'}</span>
        <span className="text-[11px]" style={{ color: 'var(--aerie-text-muted)' }}>{weather ? skyWord(weather.code) : 'Looking at the sky'}</span>
      </span>
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
    <button type="button" onClick={onOpen} className="flex h-full items-center gap-3 rounded-2xl px-3 text-left" style={surface}>
      <Mail size={20} style={{ color: from?.color || 'var(--aerie-accent)' }} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold">A letter waiting</span>
        <span className="truncate text-[11px]" style={{ color: 'var(--aerie-text-muted)' }}>from {from?.name || letter.author}</span>
      </span>
    </button>
  );
}

function DayWidget() {
  const now = useNow(60_000);
  const t = clockParts(new Date(now));
  const [weekday, ...rest] = t.dateLong.split(', ');
  return (
    <div className="flex h-full items-baseline justify-between rounded-2xl px-4 py-2" style={surface}>
      <span className="text-3xl">{weekday}</span>
      <span className="text-sm" style={{ color: 'var(--aerie-text-muted)' }}>{rest.join(', ')}</span>
    </div>
  );
}

// How long a widget has to be held before it lifts, and how far a finger can
// wander first; past that it was a swipe, not a hold. The same as the clock.
const HOLD_MS = 450;
const HOLD_SLOP = 10;
// One grid row, and the gap between rows and columns, in pixels.
const ROW_PX = 76;
const GAP_PX = 12;

interface Lifted { id: HomeWidget; dx: number; dy: number; to: Spot }

/** The widgets switched on, each in its place on a four-wide grid whose rows
 *  count up from the dock (lib/home-widgets.ts). Holding one lifts it; a
 *  dashed box shows where it will land, it lands exactly there, and
 *  anything it covers moves to the nearest open place. */
export function HomeWidgets({
  widgets,
  spots,
  companions,
  notePalette,
  onOpenAppId,
  onPlace,
}: {
  widgets: HomeWidget[];
  spots: Layout;
  companions: WidgetCompanion[];
  notePalette: string[];
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

  const layout = layoutWidgets(widgets, spots);
  const show = (next: Lifted | null) => { liftedRef.current = next; setLifted(next); };
  const stopTimer = () => { if (hold.current.timer) { window.clearTimeout(hold.current.timer); hold.current.timer = 0; } };
  useEffect(() => stopTimer, []);

  /** The place the carried widget would land, from where its top-left corner
   *  is under the finger: the nearest column, and the row counted up from the
   *  grid's bottom edge, which never moves. */
  const landing = (id: HomeWidget, clientX: number, clientY: number): Spot => {
    const g = grid.current!.getBoundingClientRect();
    const size = HOME_WIDGETS.find((w) => w.id === id)!;
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
        const room = g.getBoundingClientRect().bottom - (g.parentElement?.getBoundingClientRect().top ?? 0) - 8;
        h.rows = Math.max(layoutHeight(layout), Math.floor((room + GAP_PX) / (ROW_PX + GAP_PX)));
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
        onPlace(placeWidget(layout, widgets, id, to, h.rows));
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
  // While one is carried the grid reaches up to the top of the room, so the
  // empty space above is somewhere to put it; its bottom edge stays put.
  const height = Math.max(layoutHeight(layout), lifted ? roomRows : 0);
  const area = (id: HomeWidget, at: Spot): React.CSSProperties => {
    const size = HOME_WIDGETS.find((w) => w.id === id)!;
    return {
      gridColumn: `${at.col + 1} / span ${size.cols}`,
      gridRow: `${height - at.row - size.rows + 1} / span ${size.rows}`,
    };
  };
  return (
    <div
      ref={grid}
      className="aerie-widget-grid grid grid-cols-4"
      style={{ gap: GAP_PX, gridTemplateRows: `repeat(${height}, ${ROW_PX}px)` }}
      data-carrying={lifted ? '' : undefined}
    >
      {lifted && (
        <div
          aria-hidden="true"
          style={{ ...area(lifted.id, lifted.to), border: '2px dashed var(--aerie-accent)', borderRadius: 18, background: 'color-mix(in srgb, var(--aerie-accent) 18%, transparent)', position: 'relative', zIndex: 20, pointerEvents: 'none' }}
        />
      )}
      {widgets.map((id) => {
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
        if (id === 'companions') body = <CompanionsWidget companions={companions} onOpen={() => onOpenAppId('messages')} />;
        if (id === 'note') body = <NoteWidget companions={companions} palette={notePalette} onOpen={() => onOpenAppId('notes')} />;
        if (id === 'weather') body = <WeatherWidget onOpen={() => onOpenAppId('weather')} />;
        if (id === 'letter') body = <LetterWidget companions={companions} onOpen={() => onOpenAppId('letters')} />;
        if (id === 'day') body = <DayWidget />;
        return (
          <div
            key={id}
            data-widget-cell={id}
            data-label={HOME_WIDGETS.find((w) => w.id === id)!.label}
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
export function QuietLine({ companions, onOpen }: { companions: WidgetCompanion[]; onOpen: () => void }) {
  const { last } = useLatestReply();
  const now = useNow(30_000);
  if (!last) return null;
  const line = replyLines(last.content, 2).find((l) => !l.action) ?? replyLines(last.content, 1)[0];
  if (!line) return null;
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left" style={surface}>
      <Faces companions={companions} size={18} />
      <span className="min-w-0 flex-1 truncate text-xs">{line.text}</span>
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
}: {
  widgets: HomeWidget[];
  quietLine: boolean;
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
        className="w-full space-y-2 rounded-t-3xl p-4"
        style={{ background: 'var(--aerie-surface-strong)', color: 'var(--aerie-text)', paddingBottom: 'calc(var(--sab, 0px) + 1rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full" style={{ background: 'var(--aerie-hairline)' }} />
        <p className="text-sm font-semibold">Widgets</p>
        <p className="text-[11px] opacity-75">Hold a widget on your home screen to move it.</p>
        {HOME_WIDGETS.map((w) => {
          const on = widgets.includes(w.id);
          return (
            <button key={w.id} type="button" onClick={() => onToggle(w.id)} className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left" style={row(on)}>
              <span className="flex flex-col">
                <span className="text-sm font-semibold">{w.label}</span>
                <span className="text-[11px] opacity-75">{w.hint}</span>
              </span>
              <span className="text-[11px] font-bold tracking-widest">{w.cols}×{w.rows}</span>
            </button>
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
