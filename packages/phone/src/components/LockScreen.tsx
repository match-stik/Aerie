// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React, { useState, useEffect } from 'react';
import { motion, useAnimation, PanInfo } from 'motion/react';
import { LockClock } from './LockClock';
import { useWeather } from './useWeather';
import { ageLabel, type ClockAt, type LockFace, type LockPiece, type LockPosition, type LockShow, type LockSize, type UnreadSummary } from '../lib/lock-clock';
import type { AppDef } from '../lib/apps';
import { apiFetch } from '../aerie';
import { NOTES_SEEN_KEY, unseenCompanionNote } from '../lib/home-widgets';

interface LockFaceDot {
  url: string | null;
  color: string | null;
  name: string;
}

interface LockWriter {
  slug: string;
  name: string;
  color: string | null;
  url: string | null;
}

interface NoteRow { id: string | number; text: string; color: string; timestamp: string; sender: string | null }

/** When Notes was last opened. The first time the lock screen looks, it
 *  starts the clock at now, so only notes left after that count as new. */
function notesSeenAt(): number | null {
  try {
    const raw = localStorage.getItem(NOTES_SEEN_KEY);
    if (raw === null) {
      const now = Date.now();
      localStorage.setItem(NOTES_SEEN_KEY, String(now));
      return now;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

interface LockScreenProps {
  onUnlock: () => void;
  wallpaper?: string;
  face: LockFace;
  position: LockPosition;
  size: LockSize;
  /** Left and right corner shortcuts; a null corner is empty. */
  shortcuts: (AppDef | null)[];
  /** Opens an app straight from the lock screen, the way a phone's corners do. */
  onOpenApp: (app: AppDef) => void;
  show: LockShow;
  unread: UnreadSummary;
  faces: LockFaceDot[];
  /** The Messages app, for the card's tap. */
  messagesApp?: AppDef;
  /** Who can leave a note on the fridge, and the Notes app the note card opens. */
  writers?: LockWriter[];
  notesApp?: AppDef;
  /** Where this face's clock was dragged, and how a new spot is kept: hold
   *  the clock, drag it, and let go. */
  clockAt?: ClockAt | null;
  onMoveClock?: (at: ClockAt) => void;
  /** The weather pill moves the same way. */
  weatherAt?: ClockAt | null;
  onMoveWeather?: (at: ClockAt) => void;
  /** Which pieces are showing, and how one is tucked away: dragged up into
   *  the strip at the top. Settings brings it back. */
  showClock?: boolean;
  showWeather?: boolean;
  onHide?: (piece: LockPiece) => void;
}

export function LockScreen({ onUnlock, wallpaper, face, position, size, shortcuts, onOpenApp, show, unread, faces, messagesApp, writers = [], notesApp, clockAt = null, onMoveClock, weatherAt = null, onMoveWeather, showClock = true, showWeather = true, onHide }: LockScreenProps) {
  const [time, setTime] = useState(new Date());
  const weather = useWeather();
  const controls = useAnimation();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // A note a companion left since Notes was last opened.
  const [notes, setNotes] = useState<NoteRow[]>([]);
  useEffect(() => {
    let gone = false;
    const load = () => apiFetch('/api/notes').then((r) => (r.ok ? r.json() : [])).then((rows) => { if (!gone && Array.isArray(rows)) setNotes(rows); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { gone = true; clearInterval(t); };
  }, []);
  const [seenAt] = useState(notesSeenAt);
  const note = show === 'nothing' ? null : unseenCompanionNote(notes, writers.map((w) => w.slug), seenAt);
  const noteWriter = note ? writers.find((w) => w.slug.toLowerCase() === (note.sender || '').toLowerCase()) : undefined;
  const messagesCardUp = show !== 'nothing' && unread.count > 0;
  const cardBase = face === 'dateline' ? 184 : 124;

  const handleDragEnd = (event: any, info: PanInfo) => {
    if (info.offset.y < -100) {
      onUnlock();
    } else {
      controls.start({ y: 0, transition: { type: 'spring', stiffness: 300, damping: 20 } });
    }
  };

  return (
    <motion.div 
      className="absolute inset-0 z-50 flex flex-col items-center justify-end overflow-hidden bg-black text-white"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ y: '-100%', opacity: 0, transition: { duration: 0.4, ease: 'easeInOut' } }}
    >
      {/* Wallpaper Background */}
      {wallpaper && (
        <div 
          className="absolute inset-0 z-0 bg-cover bg-center opacity-60"
          style={{ backgroundImage: `url(${wallpaper})` }}
        />
      )}
      {!wallpaper && (
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-slate-900 to-black opacity-80" />
      )}

      {/* The clock, in the chosen face (components/LockClock.tsx). Holding it, or
          the weather pill, lifts it, and letting go leaves it there. */}
      <LockClock face={face} position={position} size={size} now={time} weather={weather} at={clockAt} onMove={onMoveClock} weatherAt={weatherAt} onMoveWeather={onMoveWeather} showClock={showClock} showWeather={showWeather} onHide={onHide} />

      {/* Who's written: names only unless the first line is chosen, and
          nothing at all if nothing is chosen. Sits above the dateline row when
          that face is up. */}
      {show !== 'nothing' && unread.count > 0 && (
        <button
          type="button"
          onClick={() => messagesApp && onOpenApp(messagesApp)}
          className="absolute inset-x-5 z-20 flex items-center gap-3 rounded-2xl border border-white/15 bg-black/45 px-4 py-3 text-left"
          style={{ bottom: face === 'dateline' ? 'calc(var(--sab, 0px) + 184px)' : 'calc(var(--sab, 0px) + 124px)' }}
        >
          <span className="flex shrink-0 -space-x-2">
            {faces.slice(0, 3).map((f, i) => (
              <span
                key={f.name + i}
                className="h-[26px] w-[26px] overflow-hidden rounded-full border-2 bg-black"
                style={{ borderColor: f.color || 'rgba(255,255,255,0.6)', zIndex: 3 - i }}
              >
                {f.url && <img src={f.url} alt="" className="h-full w-full object-cover" />}
              </span>
            ))}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              {unread.count === 1 ? '1 new message' : `${unread.count} new messages`}
              {unread.newestAt !== null && (
                <span className="font-normal text-white/60"> · {ageLabel(unread.newestAt, time.getTime())}</span>
              )}
            </span>
            {show === 'first-line' && unread.firstLine && (
              <span className="block truncate text-xs text-white/75">{unread.firstLine}</span>
            )}
          </span>
        </button>
      )}

      {/* A note on the fridge: who left it and when, and its first line if
          the first line is chosen. Sits above the messages card when that
          one is up. Opening Notes is what puts it away. */}
      {note && (
        <button
          type="button"
          onClick={() => notesApp && onOpenApp(notesApp)}
          className="absolute inset-x-5 z-20 flex items-center gap-3 rounded-2xl border border-white/15 bg-black/45 px-4 py-3 text-left"
          style={{ bottom: `calc(var(--sab, 0px) + ${cardBase + (messagesCardUp ? (show === 'first-line' && unread.firstLine ? 76 : 60) : 0)}px)` }}
        >
          <span
            className="h-[26px] w-[26px] shrink-0 overflow-hidden rounded-full border-2 bg-black"
            style={{ borderColor: noteWriter?.color || 'rgba(255,255,255,0.6)' }}
          >
            {noteWriter?.url && <img src={noteWriter.url} alt="" className="h-full w-full object-cover" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              A note from {noteWriter?.name || note.sender}
              {Number.isFinite(Date.parse(note.timestamp)) && (
                <span className="font-normal text-white/60"> · {ageLabel(Date.parse(note.timestamp), time.getTime())}</span>
              )}
            </span>
            {show === 'first-line' && note.text.trim() && (
              <span className="block truncate text-xs text-white/75">{note.text.trim().split('\n')[0]}</span>
            )}
          </span>
        </button>
      )}

      {/* The two corner shortcuts. Each opens its app straight away. */}
      {shortcuts.map((app, i) => app && (
        <button
          key={(i === 0 ? 'left-' : 'right-') + app.id}
          type="button"
          onClick={() => onOpenApp(app)}
          aria-label={app.name}
          className="absolute z-20 flex h-[52px] w-[52px] items-center justify-center rounded-full border border-white/15 bg-black/40"
          style={{ bottom: 'calc(var(--sab, 0px) + 36px)', [i === 0 ? 'left' : 'right']: 28 }}
        >
          <app.icon size={22} strokeWidth={1.6} className="text-white" />
        </button>
      ))}

      {/* Bottom Section: Swipe to Unlock */}
      <motion.div 
        className="z-10 mb-12 flex flex-col items-center"
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.2}
        onDragEnd={handleDragEnd}
        animate={controls}
      >
        <motion.div 
          className="mb-4 h-1 w-12 rounded-full bg-white/30"
          animate={{ y: [0, -10, 0] }}
          transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
        />
        <p className="text-sm font-medium tracking-widest text-white/50 uppercase">
          Swipe up to unlock
        </p>
      </motion.div>
    </motion.div>
  );
}
