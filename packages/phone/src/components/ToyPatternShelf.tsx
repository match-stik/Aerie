// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The pattern shelf on the Toys page: record what their person's fingers do, keep it,
// and play any pattern on the shelf, their person's or a companion's, on whatever toy is
// connected, once or on a loop.
//
// Recording listens to their person's own hand only: the sliders and the orbs reach it
// through the page's tap (ToysApp passes every level they set), and the clock
// starts at their first touch, so a recording never opens on dead air. The
// first toy they touch is the one recorded, its motors kept in order as
// motor1, motor2 (backend services/toy-patterns.ts says why).
//
// Playing is theirs too: the shelf sends levels through the page's own drive,
// the same road their sliders take, so the line, the sliders and the leaving-
// zeros all see it. Their person's hand on any slider or orb takes over at once and the
// pattern stops; their stop stops it; a companion starting to play from the house
// stops it.

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { ChevronDown, Circle, Play, Repeat, Square, Trash2 } from 'lucide-react';
import type { ToyStep } from '@aerie/shared';
import { api } from '../aerie/api';
import { motorsFor, type LovenseToy } from '../aerie/lovense-toys';
import { ownerForCompanion } from '../lib/orb-field';
import { ownPlaying, playOwnPattern, setOwnLoop, stopOwn, useOwnPlay } from '../aerie/own-play';
import { RECORD_MAX_MS, clock, patternLength, previewPoints, stepsFromChanges, stitchTracks, type LevelChange } from '../lib/toy-patterns';
import { cn } from '../lib/utils';
import { toyName } from '../lib/toy-names';

export interface ShelfPattern {
  id: string;
  name: string;
  companion: string | null;
  tracks: Record<string, ToyStep[]>;
  lengthMs: number;
  createdAt: string;
}

export type LevelTap = (toyId: string, command: string, level: number) => void;

interface Props {
  connected: LovenseToy[];
  levels: Record<string, number>;
  /** The page calls this with every level their person's own hand sets. */
  tapRef: MutableRefObject<LevelTap | null>;
  /** Goes up every time their stop is pressed or the toys are stopped for them. */
  stopEpoch: number;
  lanePlaying: boolean;
  holding: boolean;
  accentHex: string;
  panelClass: string;
  textMain: string;
  textMuted: string;
  panelBorder: string;
}

interface Recording {
  pressedAt: number;
  startedAt: number | null;
  toyId: string | null;
  motors: string[];
  startLevels: Record<string, number>;
  changes: Record<string, LevelChange[]>;
}

const LOOP_KEY = 'aerie.toys.patternLoop';
const OPEN_KEY = 'aerie.toys.patternsOpen';
/** Patterns shown at once; the rest are a page turn away, so the shelf never scrolls forever (theirs, Nov 9 2026). */
const PAGE_SIZE = 5;

export function ToyPatternShelf(props: Props) {
  const { connected, levels, tapRef, stopEpoch, lanePlaying, holding, accentHex, panelClass, textMain, textMuted, panelBorder } = props;
  const [patterns, setPatterns] = useState<ShelfPattern[] | null>(null);
  // What plays lives in aerie/own-play.ts, outside this page, so it keeps
  // going while they are in the chat (theirs, Nov 10 2026).
  const own = useOwnPlay();
  const loop = own.loop;
  const shelfPlaying = own.playing?.kind === 'shelf' ? own.playing : null;
  const playingId = shelfPlaying?.id ?? null;
  const nowPlaying = shelfPlaying ? { name: shelfPlaying.name, ids: shelfPlaying.ids, lengthMs: shelfPlaying.lengthMs } : null;
  // Their Loop choice is remembered on this phone and handed to the player once.
  useEffect(() => {
    try { setOwnLoop(localStorage.getItem(LOOP_KEY) !== 'off'); } catch { setOwnLoop(true); }
  }, []);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [draft, setDraft] = useState<{ tracks: Record<string, ToyStep[]>; lengthMs: number } | null>(null);
  const [draftName, setDraftName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [, setTick] = useState(0);
  // Picking: tap patterns in the order they want them, then play them in that
  // order or stitch them into one new pattern on the shelf.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [stitchName, setStitchName] = useState('');
  const [page, setPage] = useState(0);
  // The shelf folds to its header row, so Record is a tap away and the
  // sliders are not a scroll below it (theirs, Nov 9 2026).
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(OPEN_KEY) !== 'closed'; } catch { return true; }
  });
  const setOpenKept = (next: boolean) => {
    setOpen(next);
    try { localStorage.setItem(OPEN_KEY, next ? 'open' : 'closed'); } catch { /* not remembered */ }
  };

  const recordingRef = useRef<Recording | null>(null);
  const levelsRef = useRef(levels);
  levelsRef.current = levels;
  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/toys/patterns');
      if (!(res.headers.get('content-type') || '').includes('json')) {
        // An older house answers this address with the app's own page.
        setPatterns([]);
        setNote('The shelf arrives with the next house restart.');
        return;
      }
      const body = await res.json();
      if (res.ok && Array.isArray(body?.patterns)) setPatterns(body.patterns as ShelfPattern[]);
      else setPatterns([]);
    } catch {
      setPatterns([]);
      setNote('The shelf did not load. Is the house reachable?');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ---- playing ----

  const stopPlaying = useCallback((zero: boolean, except?: string) => {
    stopOwn(zero, except);
  }, []);

  const play = useCallback((pattern: { id: string; name: string; tracks: Record<string, ToyStep[]> }, ids: string[] = [pattern.id]) => {
    setNote(playOwnPattern(pattern, connectedRef.current, ids));
  }, []);

  /** Several patterns, one after another, as one: play all, or their picks in the order they tapped them. */
  const playSeveral = useCallback((list: ShelfPattern[], name: string) => {
    if (list.length === 0) return;
    if (list.length === 1) { play(list[0]); return; }
    play({ id: `set:${list.map((p) => p.id).join(',')}`, name, tracks: stitchTracks(list) }, list.map((p) => p.id));
  }, [play]);

  // While something plays: the time left, ticking.
  useEffect(() => {
    if (!playingId) return;
    const timer = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, [playingId]);

  const togglePick = (id: string) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const pickedPatterns = (): ShelfPattern[] =>
    picked.map((id) => patterns?.find((p) => p.id === id)).filter((p): p is ShelfPattern => Boolean(p));

  const stitch = async () => {
    const list = pickedPatterns();
    if (list.length < 2) return;
    const tracks = stitchTracks(list);
    const name = (stitchName.trim() || list.map((p) => p.name).join(' + ')).slice(0, 60);
    try {
      const res = await api.post('/api/toys/patterns', { name, tracks });
      const body = await res.json();
      if (!res.ok || !body?.pattern) {
        setNote(body?.error || 'The house would not keep that one.');
        return;
      }
      setPatterns((prev) => [body.pattern as ShelfPattern, ...(prev ?? [])]);
      setPage(0);
      setPicking(false);
      setPicked([]);
      setStitchName('');
      setNote(`Stitched into "${(body.pattern as ShelfPattern).name}", ${clock((body.pattern as ShelfPattern).lengthMs)} long.`);
    } catch {
      setNote('The house did not answer, so it is not stitched yet. Try again.');
    }
  };

  const toggleLoop = () => {
    const next = !loop;
    setOwnLoop(next);
    try { localStorage.setItem(LOOP_KEY, next ? 'on' : 'off'); } catch { /* not remembered */ }
  };

  // ---- recording ----

  const finishRecording = useCallback(() => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    setRecording(null);
    if (!rec) return;
    if (!rec.toyId || rec.startedAt === null) {
      setNote('Nothing was recorded. Press record, then move a slider or the orbs.');
      return;
    }
    const total = Math.min(RECORD_MAX_MS, Date.now() - rec.startedAt);
    const tracks: Record<string, ToyStep[]> = {};
    rec.motors.forEach((command, i) => {
      const steps = stepsFromChanges(rec.changes[command] ?? [], rec.startLevels[command] ?? 0, total);
      if (steps.some(([level]) => level > 0)) tracks[`motor${i + 1}`] = steps;
    });
    if (Object.keys(tracks).length === 0) {
      setNote('Nothing was recorded. Press record, then move a slider or the orbs.');
      return;
    }
    setDraft({ tracks, lengthMs: patternLength(tracks) });
    setDraftName('');
  }, []);

  const startRecording = () => {
    setNote(null);
    setDraft(null);
    stopPlaying(true);
    // Folded while they record, so the sliders sit right under the button.
    setOpen(false);
    const rec: Recording = { pressedAt: Date.now(), startedAt: null, toyId: null, motors: [], startLevels: {}, changes: {} };
    recordingRef.current = rec;
    setRecording(rec);
  };

  // While recording: the clock on screen, and the stop at two minutes.
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      setTick((n) => n + 1);
      const rec = recordingRef.current;
      if (rec?.startedAt !== null && rec?.startedAt !== undefined && Date.now() - rec.startedAt >= RECORD_MAX_MS) finishRecording();
    }, 250);
    return () => clearInterval(timer);
  }, [recording, finishRecording]);

  // Their person's hand: it takes over from a playing pattern, and a recording writes it down.
  useEffect(() => {
    tapRef.current = (toyId, command, level) => {
      if (ownPlaying()) stopPlaying(true, `${toyId}:${command}`);
      const rec = recordingRef.current;
      if (!rec) return;
      // A zero is never the first touch (opening the orbs zeroes every motor
      // first), so the clock waits for them to actually start.
      if (!rec.toyId && level === 0) return;
      if (!rec.toyId) {
        const toy = connectedRef.current.find((t) => t.toyId === toyId);
        if (!toy) return;
        rec.toyId = toyId;
        rec.startedAt = Date.now();
        rec.motors = motorsFor(toy).map((m) => m.command);
        for (const m of rec.motors) rec.startLevels[m] = levelsRef.current[`${toyId}:${m}`] ?? 0;
      }
      if (rec.toyId !== toyId || rec.startedAt === null || !rec.motors.includes(command)) return;
      (rec.changes[command] ??= []).push({ at: Date.now() - rec.startedAt, level });
    };
    return () => { tapRef.current = null; };
  }, [tapRef, stopPlaying]);

  // Their person's stop ends whatever the shelf is doing; a companion playing does too.
  const firstEpoch = useRef(stopEpoch);
  useEffect(() => {
    if (stopEpoch === firstEpoch.current) return;
    stopPlaying(false);
    if (recordingRef.current) finishRecording();
  }, [stopEpoch, stopPlaying, finishRecording]);
  useEffect(() => {
    if (lanePlaying && ownPlaying()) stopPlaying(false);
  }, [lanePlaying, stopPlaying]);

  // Leaving the page ends a recording; what is playing keeps playing (aerie/own-play.ts).
  useEffect(() => () => { recordingRef.current = null; }, []);

  // ---- the shelf ----

  const save = async () => {
    if (!draft) return;
    const name = draftName.trim() || `Pattern ${(patterns?.length ?? 0) + 1}`;
    try {
      const res = await api.post('/api/toys/patterns', { name, tracks: draft.tracks });
      const body = await res.json();
      if (!res.ok || !body?.pattern) {
        setNote(body?.error || 'The house would not keep that one.');
        return;
      }
      setPatterns((prev) => [body.pattern as ShelfPattern, ...(prev ?? [])]);
      setPage(0);
      setDraft(null);
    } catch {
      setNote('The house did not answer, so it is not saved yet. Try again.');
    }
  };

  const remove = async (pattern: ShelfPattern) => {
    if (confirmDelete !== pattern.id) {
      setConfirmDelete(pattern.id);
      return;
    }
    setConfirmDelete(null);
    if (ownPlaying()?.id === pattern.id) stopPlaying(true);
    const res = await api.delete(`/api/toys/patterns/${encodeURIComponent(pattern.id)}`).catch(() => null);
    if (res?.ok) setPatterns((prev) => (prev ?? []).filter((p) => p.id !== pattern.id));
    else setNote('That one would not clear. Try again.');
  };

  const rename = async (pattern: ShelfPattern, value: string) => {
    setRenaming(null);
    const name = value.replace(/\s+/g, ' ').trim();
    if (!name || name === pattern.name) return;
    const res = await api.patch(`/api/toys/patterns/${encodeURIComponent(pattern.id)}`, { name }).catch(() => null);
    if (res?.ok) setPatterns((prev) => (prev ?? []).map((p) => (p.id === pattern.id ? { ...p, name } : p)));
    else setNote('That name would not take. Try again.');
  };

  const madeBy = (p: ShelfPattern) => (p.companion ? ownerForCompanion(p.companion) : { name: 'Yours', color: accentHex });

  const preview = (tracks: Record<string, ToyStep[]>, lengthMs: number, color: string) => (
    <svg width={84} height={24} viewBox="0 0 84 24" className="shrink-0" aria-hidden>
      {Object.keys(tracks).sort().reverse().map((key, i, all) => (
        <polyline
          key={key}
          points={previewPoints(tracks[key], lengthMs, 84, 24)}
          fill="none"
          stroke={color}
          strokeOpacity={i === all.length - 1 ? 1 : 0.4}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );

  const left = (() => {
    if (!nowPlaying || !playingId) return null;
    const into = Math.max(0, Date.now() - (shelfPlaying?.roundStart ?? Date.now()));
    return Math.max(0, nowPlaying.lengthMs - into);
  })();
  const pages = Math.max(1, Math.ceil((patterns?.length ?? 0) / PAGE_SIZE));
  const shownPage = Math.min(page, pages - 1);
  const shown = (patterns ?? []).slice(shownPage * PAGE_SIZE, shownPage * PAGE_SIZE + PAGE_SIZE);
  const pickedCount = picked.length;
  const pickedLength = pickedCount ? patternLength(stitchTracks(pickedPatterns())) : 0;

  const rec = recording;
  const recElapsed = rec?.startedAt ? Date.now() - rec.startedAt : 0;
  const recToy = rec?.toyId ? connected.find((t) => t.toyId === rec.toyId) : null;

  return (
    <div className={cn(panelClass, 'flex flex-col gap-3 p-4', holding && 'opacity-60')}>
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => setOpenKept(!open)} className={cn('flex items-center gap-1.5 text-sm font-medium', textMain)} aria-expanded={open}>
          <ChevronDown size={14} className={cn('transition-transform', !open && '-rotate-90')} />
          Patterns
          {!open && patterns && patterns.length > 0 && <span className={cn('text-xs font-normal', textMuted)}>({patterns.length})</span>}
        </button>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {patterns && patterns.length > 1 && !rec && (
            <button
              onClick={() => { setPicking(false); setPicked([]); playSeveral(patterns, 'Everything on the shelf'); }}
              disabled={holding}
              className={cn('flex items-center gap-1 rounded-[var(--shape-control)] border px-2.5 py-1 text-xs disabled:opacity-40', panelBorder, textMain)}
            >
              <Play size={11} fill="currentColor" /> Play all
            </button>
          )}
          {patterns && patterns.length > 1 && !rec && (
            <button
              onClick={() => { setPicking((v) => !v); setPicked([]); setStitchName(''); setOpenKept(true); }}
              className={cn('rounded-[var(--shape-control)] border px-2.5 py-1 text-xs', panelBorder)}
              style={picking ? { borderColor: accentHex, color: accentHex } : undefined}
              aria-pressed={picking}
            >
              {picking ? 'Done picking' : 'Pick'}
            </button>
          )}
          <button
            onClick={toggleLoop}
            className={cn('flex items-center gap-1 rounded-[var(--shape-control)] border px-2.5 py-1 text-xs', panelBorder)}
            style={loop ? { borderColor: accentHex, color: accentHex } : undefined}
            aria-pressed={loop}
          >
            <Repeat size={12} /> Loop
          </button>
          {rec ? (
            <button
              onClick={finishRecording}
              className="flex items-center gap-1.5 rounded-[var(--shape-control)] px-2.5 py-1 text-xs font-medium"
              style={{ background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' }}
            >
              <Square size={11} fill="currentColor" /> Stop recording
            </button>
          ) : (
            <button
              onClick={startRecording}
              disabled={holding}
              className={cn('flex items-center gap-1.5 rounded-[var(--shape-control)] border px-2.5 py-1 text-xs disabled:opacity-40', panelBorder, textMain)}
            >
              <Circle size={10} fill="#ef4444" stroke="#ef4444" /> Record
            </button>
          )}
        </div>
      </div>

      {nowPlaying && left !== null && (
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className={cn('min-w-0 truncate', textMain)}>
            Playing {nowPlaying.name}
            {nowPlaying.ids.length > 1 ? `, ${nowPlaying.ids.length} patterns` : ''}
          </span>
          <span className="shrink-0 tabular-nums" style={{ color: accentHex }}>
            {clock(left)} left{loop ? ', then again' : ''}
          </span>
        </div>
      )}

      {picking && open && (
        <div className={cn('flex flex-col gap-2 rounded-[var(--shape-control)] border p-3', panelBorder)}>
          <p className={cn('text-xs', textMuted)}>
            {pickedCount === 0
              ? 'Tap patterns in the order you want them.'
              : `${pickedCount} picked, ${clock(pickedLength)} all together.`}
          </p>
          {pickedCount >= 2 && (
            <input
              value={stitchName}
              onChange={(e) => setStitchName(e.target.value)}
              maxLength={60}
              placeholder="Name for the stitched one (optional)"
              className={cn('w-full rounded-[var(--shape-chip)] border bg-transparent px-2.5 py-1.5 text-sm outline-none', panelBorder, textMain)}
            />
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => playSeveral(pickedPatterns(), pickedCount === 1 ? (pickedPatterns()[0]?.name ?? '') : 'Your picks')}
              disabled={pickedCount === 0 || holding}
              className={cn('rounded-[var(--shape-chip)] border px-3 py-1.5 text-xs disabled:opacity-40', panelBorder, textMain)}
            >
              Play these
            </button>
            <button
              onClick={() => void stitch()}
              disabled={pickedCount < 2}
              className="rounded-[var(--shape-chip)] px-3 py-1.5 text-xs font-medium disabled:opacity-40"
              style={{ background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' }}
            >
              Stitch into one
            </button>
          </div>
          {pickedCount >= 2 && pickedLength > RECORD_MAX_MS && (
            <p className={cn('text-[11px]', textMuted)}>One pattern on the shelf can be up to an hour, so this many plays fine but won't stitch. Pick fewer to keep it as one.</p>
          )}
        </div>
      )}

      {rec && (
        <p className={cn('text-xs', textMuted)}>
          {rec.startedAt === null
            ? 'Recording starts at your first touch. Drive with the sliders or the orbs; the first toy you touch is the one kept.'
            : <>
                <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500 align-middle" />
                {clock(recElapsed)} of {clock(RECORD_MAX_MS)}{recToy ? `, on ${toyName(recToy)}` : ''}
              </>}
        </p>
      )}

      {draft && (
        <div className={cn('flex flex-col gap-2 rounded-[var(--shape-control)] border p-3', panelBorder)}>
          <div className="flex items-center gap-2">
            {preview(draft.tracks, draft.lengthMs, accentHex)}
            <span className={cn('text-xs', textMuted)}>{clock(draft.lengthMs)} recorded</span>
          </div>
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
            maxLength={60}
            placeholder="Name it"
            className={cn('w-full rounded-[var(--shape-chip)] border bg-transparent px-2.5 py-1.5 text-sm outline-none', panelBorder, textMain)}
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setDraft(null)} className={cn('rounded-[var(--shape-chip)] border px-3 py-1.5 text-xs', panelBorder, textMuted)}>Let it go</button>
            <button
              onClick={() => void save()}
              className="rounded-[var(--shape-chip)] px-3 py-1.5 text-xs font-medium"
              style={{ background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' }}
            >
              Put it on the shelf
            </button>
          </div>
        </div>
      )}

      {note && (
        <div className="flex items-start justify-between gap-3 text-xs">
          <span className={textMain}>{note}</span>
          <button onClick={() => setNote(null)} className={textMuted}>Dismiss</button>
        </div>
      )}

      {open && (
        <>
      {patterns === null && <p className={cn('text-xs', textMuted)}>Fetching the shelf…</p>}
      {patterns && patterns.length === 0 && !draft && (
        <p className={cn('text-xs', textMuted)}>Nothing on the shelf yet. Press record and drive, and it keeps what your fingers did.</p>
      )}

      {patterns && patterns.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {shown.map((p) => {
            const by = madeBy(p);
            const on = playingId === p.id || Boolean(nowPlaying && nowPlaying.ids.length > 1 && nowPlaying.ids.includes(p.id));
            const pickAt = picked.indexOf(p.id);
            return (
              <div
                key={p.id}
                className={cn('flex items-center gap-2.5 rounded-[var(--shape-control)] border px-2.5 py-2', panelBorder)}
                style={on ? { borderColor: by.color } : undefined}
              >
                {preview(p.tracks, p.lengthMs, by.color)}
                <div className="min-w-0 flex-1">
                  {renaming === p.id ? (
                    <input
                      autoFocus
                      defaultValue={p.name}
                      maxLength={60}
                      onBlur={(e) => void rename(p, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }}
                      className={cn('w-full rounded-[var(--shape-chip)] border bg-transparent px-1.5 py-0.5 text-sm outline-none', panelBorder, textMain)}
                    />
                  ) : (
                    <button onClick={() => setRenaming(p.id)} className={cn('block max-w-full truncate text-left text-sm', textMain)} title="Rename">
                      {p.name}
                    </button>
                  )}
                  <span className="text-[11px]" style={{ color: by.color }}>{by.name}</span>
                  <span className={cn('text-[11px]', textMuted)}> · {clock(p.lengthMs)}</span>
                </div>
                {picking ? (
                  <button
                    onClick={() => togglePick(p.id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                    style={pickAt >= 0 ? { background: by.color, color: '#0b0a0f' } : { border: `1px dashed ${by.color}`, color: by.color }}
                    aria-label={pickAt >= 0 ? `Unpick ${p.name}` : `Pick ${p.name}`}
                    aria-pressed={pickAt >= 0}
                  >
                    {pickAt >= 0 ? pickAt + 1 : '+'}
                  </button>
                ) : (
                <button
                  onClick={() => (on ? stopPlaying(true) : play(p))}
                  disabled={holding}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
                  style={on ? { background: by.color, color: '#0b0a0f' } : { border: `1px solid ${by.color}`, color: by.color }}
                  aria-label={on ? `Stop ${p.name}` : `Play ${p.name}`}
                >
                  {on ? <Square size={12} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
                </button>
                )}
                <button
                  onClick={() => void remove(p)}
                  className={cn('shrink-0 text-[11px]', textMuted)}
                  aria-label={`Clear ${p.name} off the shelf`}
                >
                  {confirmDelete === p.id ? 'Sure?' : <Trash2 size={14} />}
                </button>
              </div>
            );
          })}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-1 text-xs">
              <button
                onClick={() => setPage(Math.max(0, shownPage - 1))}
                disabled={shownPage === 0}
                className={cn('rounded-[var(--shape-control)] border px-2.5 py-1 disabled:opacity-30', panelBorder, textMain)}
                aria-label="Previous patterns"
              >
                ‹
              </button>
              <span className={cn('tabular-nums', textMuted)}>{shownPage + 1} of {pages}</span>
              <button
                onClick={() => setPage(Math.min(pages - 1, shownPage + 1))}
                disabled={shownPage >= pages - 1}
                className={cn('rounded-[var(--shape-control)] border px-2.5 py-1 disabled:opacity-30', panelBorder, textMain)}
                aria-label="More patterns"
              >
                ›
              </button>
            </div>
          )}
        </div>
      )}
        </>
      )}
    </div>
  );
}
