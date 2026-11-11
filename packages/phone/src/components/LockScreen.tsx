// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React, { useState, useEffect } from 'react';
import { motion, useAnimation, PanInfo } from 'motion/react';
import { ClockFaceBody, WeatherBody } from './LockClock';
import { LockGrid } from './LockGrid';
import type { GridSpot } from '../lib/grid-place';
import type { LockGridPiece } from '../lib/lock-grid';
import { useWeather } from './useWeather';
import { ageLabel, type ClockAt, type LockFace, type LockPiece, type LockPosition, type LockShow, type LockSize, type LockWeatherLook, type UnreadSummary } from '../lib/lock-clock';
import type { AppDef } from '../lib/apps';
import { apiFetch } from '../aerie';
import { NOTES_SEEN_KEY, unseenCompanionNote } from '../lib/home-widgets';
import { LockSpotifyCard } from './LockSpotifyCard';
import { lockCardInk, useLockCardLook, type LockCardChoice } from '../lib/lock-cards';

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
  /** The Spotify card's switch (Settings > Lock screen, on unless their person
   *  turned it off), and the Spotify app a tap on the card opens. */
  spotify?: boolean;
  spotifyApp?: AppDef;
  /** How the Spotify card is drawn (Settings > Lock screen). */
  spotifyLook?: import('../lib/lock-spotify').LockSpotifyLook;
  /** How the cards look: dark, light, or auto, read off the wallpaper behind
   *  them (Settings > Lock screen; lib/lock-cards.ts). Unset is dark. */
  cards?: LockCardChoice;
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
  /** Where each piece sits on the lock screen's grid (lib/lock-grid.ts, theirs,
   *  Nov 8 2026), and how a new place is kept. */
  spots?: Partial<Record<LockGridPiece, GridSpot>>;
  onPlace?: (spots: Record<LockGridPiece, GridSpot>) => void;
  /** How the weather looks (Settings > Lock screen). */
  weatherLook?: LockWeatherLook;
  /** The cards' tint (lib/lock-cards.ts lockCardBacksOf); off, they float. */
  cardBacks?: boolean;
}

export function LockScreen({ onUnlock, wallpaper, face, position, size, shortcuts, onOpenApp, show, unread, faces, messagesApp, writers = [], notesApp, spotify = true, spotifyApp, spotifyLook = 'bar', cards = 'dark', clockAt = null, weatherAt = null, showClock = true, showWeather = true, onHide, spots = {}, onPlace, weatherLook = 'pill', cardBacks = true }: LockScreenProps) {
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
  // One look for every card on the lock screen, theirs or read off the wallpaper.
  const look = useLockCardLook(cards, wallpaper);
  const ink = lockCardInk(look, cardBacks);
  const messagesCardUp = show !== 'nothing' && unread.count > 0;

  const handleDragEnd = (event: any, info: PanInfo) => {
    if (info.offset.y < -100) {
      onUnlock();
    } else {
      controls.start({ y: 0, transition: { type: 'spring', stiffness: 300, damping: 20 } });
    }
  };

  return (
    <motion.div 
      data-lock-frame=""
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

      {/* Every piece on the grid (components/LockGrid.tsx, theirs, Nov 8 2026):
          the clock in them face and size, the weather in its look, who's
          written, a note on the fridge, and what is playing. Holding one
          lifts it; nothing slides out of anything's way. */}
      <LockGrid
        face={face}
        saved={spots}
        legacy={{ clock: clockAt, weather: weatherAt }}
        onPlace={onPlace}
        onHide={onHide ? (id) => { if (id === 'clock' || id === 'weather') onHide(id); } : undefined}
        items={[
          { id: 'messages', present: messagesCardUp, full: true, node: (
          <button
            type="button"
            onClick={() => messagesApp && onOpenApp(messagesApp)}
            className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left ${ink.card}`}
          >
            <span className="flex shrink-0 -space-x-2">
              {faces.slice(0, 3).map((f, i) => (
                <span
                  key={f.name + i}
                  className={`h-[26px] w-[26px] overflow-hidden rounded-full border-2 ${ink.face}`}
                  style={{ borderColor: f.color || ink.ring, zIndex: 3 - i }}
                >
                  {f.url && <img src={f.url} alt="" className="h-full w-full object-cover" />}
                </span>
              ))}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">
                {unread.count === 1 ? '1 new message' : `${unread.count} new messages`}
                {unread.newestAt !== null && (
                  <span className={`font-normal ${ink.muted}`}> · {ageLabel(unread.newestAt, time.getTime())}</span>
                )}
              </span>
              {show === 'first-line' && unread.firstLine && (
                <span className={`block truncate text-xs ${ink.line}`}>{unread.firstLine}</span>
              )}
            </span>
          </button>
          ) },
          { id: 'note', present: !!note, full: true, node: note ? (
          <button
            type="button"
            onClick={() => notesApp && onOpenApp(notesApp)}
            className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left ${ink.card}`}
          >
            <span
              className={`h-[26px] w-[26px] shrink-0 overflow-hidden rounded-full border-2 ${ink.face}`}
              style={{ borderColor: noteWriter?.color || ink.ring }}
            >
              {noteWriter?.url && <img src={noteWriter.url} alt="" className="h-full w-full object-cover" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">
                A note from {noteWriter?.name || note.sender}
                {Number.isFinite(Date.parse(note.timestamp)) && (
                  <span className={`font-normal ${ink.muted}`}> · {ageLabel(Date.parse(note.timestamp), time.getTime())}</span>
                )}
              </span>
              {show === 'first-line' && note.text.trim() && (
                <span className={`block truncate text-xs ${ink.line}`}>{note.text.trim().split('\n')[0]}</span>
              )}
            </span>
          </button>
          ) : null },
          { id: 'spotify', present: spotify, full: spotifyLook !== 'cover', node: (
            <LockSpotifyCard fetcher={apiFetch} base={0} placed backs={cardBacks} look={look} shape={spotifyLook} onOpen={spotifyApp ? () => onOpenApp(spotifyApp) : undefined} />
          ) },
          { id: 'clock', present: showClock, hideable: true, node: <ClockFaceBody face={face} size={size} now={time} /> },
          { id: 'weather', present: !!weather && showWeather, hideable: true, node: weather ? <WeatherBody weather={weather} look={weatherLook} backs={cardBacks} /> : null },
        ]}
      />

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
