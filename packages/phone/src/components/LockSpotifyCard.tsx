// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The lock screen's Spotify card (Oct 20 2026): while a song is playing or paused, its cover, the
// song and the artist, and previous, play or pause, and next, pressed the way
// the Spotify app presses them (the one keeper, lib/spotify.ts
// createSpotifyNow, and the app's own Controls). A tap on the cover or the
// words opens the Spotify app. Anything that is not the house's own answer is
// no card, and the only words it ever says are a press's sentence.
//
// LAYOUT NOTE: the shape and the look of the lock screen's other cards, dark
// or light the way their person switch says (lib/lock-cards.ts), nothing blurred. It
// sits on top of the other cards, and when that would touch the clock or the
// weather it climbs above them; where nothing has room it waits out of sight
// (lib/lock-spotify.ts liftLockCard).

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SpotifyNowView } from '@aerie/shared';
import { Controls, Cover, type PressState } from './spotify/SpotifyViews';
import { useSpotifyNow } from '../lib/use-spotify-now';
import { createLockSpotify, liftLockCard, lockSpotifyTrack, type LockSpotifyLook, type Span } from '../lib/lock-spotify';
import { troubleLine } from '../lib/spotify';
import { wakeSpotify } from '../aerie/spotify-wake';
import { lockCardInk, type LockCardLook } from '../lib/lock-cards';

/** The card as drawn: nothing in here fetches, so each state renders on its own. */
export function LockSpotifyCardView({ view, press, onOpen, look = 'dark', shape = 'bar', backs = true, compact = false }: { view: SpotifyNowView | null; press: PressState; onOpen?: () => void; look?: LockCardLook; shape?: LockSpotifyLook; backs?: boolean; compact?: boolean }) {
  const track = view?.track ?? null;
  const ink = lockCardInk(look, backs);
  // Nothing playing is a quiet line that opens Spotify, the way the home
  // screen's widget has it (theirs, Nov 11 2026: 'nothing shows up on the lock
  // screen when nothing is playing. But it does on the home screen.').
  if (!view || !track) return <LockSpotifyQuiet ink={ink} shape={shape} onOpen={onOpen} compact={compact} />;
  const notice = press.notice && press.notice.where.startsWith('now:') ? press.notice.trouble : null;
  const noticeLine = notice && (
    <p role="status" className={`mt-1.5 line-clamp-2 text-xs [overflow-wrap:anywhere] ${ink.muted}`}>
      {troubleLine(notice)}
    </p>
  );
  const openLabel = `Open Spotify: ${track.name}${track.artist ? `, ${track.artist}` : ''}`;

  // The record (theirs, Nov 7 2026: the big card was a bit much, so a circular
  // cut of the cover with the buttons floating centered under it): no card
  // around it, just the round cover, the song, and the three buttons on their
  // own little sheets over them wallpaper.
  if (shape === 'cover') {
    const words = ink.float;
    const body = (
      <>
        <span className="mx-auto block h-20 w-20 overflow-hidden rounded-full shadow-xl ring-2" style={{ ['--tw-ring-color' as string]: ink.ring }}>
          <Cover src={track.cover} eager className="h-full w-full object-cover" />
        </span>
        <span className={`mt-2 block truncate text-center text-[13px] font-semibold ${words}`}>{track.name}</span>
        {track.artist && <span className={`block truncate text-center text-xs opacity-80 ${words}`}>{track.artist}</span>}
      </>
    );
    return (
      // On the lock screen's grid the record keeps to half the width
      // (theirs, Nov 8 2026), so the clock or the weather can sit beside it.
      <div className={`${ink.float}${compact ? ' w-[10.5rem]' : ''}`}>
        {onOpen
          ? <button type="button" onClick={onOpen} aria-label={openLabel} className="mx-auto block w-full max-w-[14rem]">{body}</button>
          : <div className="mx-auto max-w-[16rem]">{body}</div>}
        <Controls playing={view.playing} press={press} size="record" sheet={ink.disc} />
        {noticeLine}
      </div>
    );
  }

  // One slim line: a small cover, the song, and the buttons (Nov 7 2026).
  if (shape === 'slim') {
    const body = (
      <>
        <Cover src={track.cover} eager className="h-8 w-8 shrink-0 rounded-full" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {track.name}{track.artist && <span className={`font-normal ${ink.muted}`}> · {track.artist}</span>}
        </span>
      </>
    );
    return (
      <div className={`rounded-full border py-1 pl-1.5 pr-1 ${ink.card}`}>
        <div className="flex items-center gap-2">
          {onOpen
            ? <button type="button" onClick={onOpen} aria-label={openLabel} className="flex min-w-0 flex-1 items-center gap-2 text-left">{body}</button>
            : <div className="flex min-w-0 flex-1 items-center gap-2">{body}</div>}
          <Controls playing={view.playing} press={press} size="slim" sheet={ink.sheet} />
        </div>
        {noticeLine}
      </div>
    );
  }

  const words = (
    <>
      <Cover src={track.cover} eager className="h-12 w-12 shrink-0 rounded-lg" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{track.name}</span>
        {track.artist && <span className={`block truncate text-xs ${ink.muted}`}>{track.artist}</span>}
      </span>
    </>
  );
  return (
    <div className={`rounded-2xl border px-3 py-2.5 ${ink.card}`}>
      <div className="flex items-center gap-2">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={openLabel}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            {words}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">{words}</div>
        )}
        <Controls playing={view.playing} press={press} size="card" sheet={ink.sheet} />
      </div>
      {noticeLine}
    </div>
  );
}

function LockSpotifyQuiet({ ink, shape, onOpen, compact }: { ink: ReturnType<typeof lockCardInk>; shape: LockSpotifyLook; onOpen?: () => void; compact: boolean }) {
  const words = (
    <>
      <span className="text-sm font-semibold">Spotify</span>
      <span className={`text-xs ${shape === 'cover' ? 'opacity-80' : ink.muted}`}>Nothing playing</span>
    </>
  );
  const frame = shape === 'cover'
    ? `${ink.float} flex flex-col items-center gap-0.5 text-center${compact ? ' w-[10.5rem]' : ''}`
    : shape === 'slim'
      ? `rounded-full border px-4 py-2 flex items-center gap-3 ${ink.card}`
      : `rounded-2xl border px-4 py-3 flex items-center gap-3 ${ink.card}`;
  return onOpen
    ? <button type="button" onClick={onOpen} aria-label="Open Spotify" className={`${frame} w-full text-left`}>{words}</button>
    : <div className={frame}>{words}</div>;
}

/**
 * The card, live. `base` is its own spot in px above the bottom safe edge, on
 * top of the other cards; it reads when it mounts, on every wake, and when the
 * song should end, and stops when the lock screen goes.
 */
export function LockSpotifyCard({
  fetcher,
  base,
  onOpen,
  look = 'dark',
  shape = 'bar',
  placed = false,
  backs = true,
}: {
  fetcher: (url: string, init?: RequestInit) => Promise<Response>;
  base: number;
  /** Placed by the lock screen's grid (lib/lock-grid.ts, Nov 8 2026): drawn
   *  where its parent puts it, and it never slides out of anything's way. */
  placed?: boolean;
  /** Off, the card's tint is gone and the words float (lib/lock-cards.ts). */
  backs?: boolean;
  onOpen?: () => void;
  look?: LockCardLook;
  shape?: LockSpotifyLook;
}) {
  const [lock] = useState(() => createLockSpotify(fetcher, undefined, wakeSpotify));
  const state = useSpotifyNow(lock.keeper);
  useEffect(() => {
    void lock.start();
    const woke = () => {
      if (document.visibilityState === 'visible') void lock.look();
    };
    document.addEventListener('visibilitychange', woke);
    return () => {
      document.removeEventListener('visibilitychange', woke);
      lock.stop();
    };
  }, [lock]);

  // Where it sits, measured against the clock and the weather wherever their person has
  // put them, on every draw (the lock screen draws once a second).
  const ref = useRef<HTMLDivElement>(null);
  const ceilingRef = useRef<HTMLDivElement>(null);
  const [lift, setLift] = useState<number | null | undefined>(undefined);
  const moved = useRef({ since: 0, count: 0 });
  useLayoutEffect(() => {
    if (placed) return;
    const el = ref.current;
    const frame = el?.closest<HTMLElement>('[data-lock-frame]');
    if (!el || !frame) return;
    const top = frame.getBoundingClientRect().top;
    const box = el.getBoundingClientRect();
    const raised = lift ?? 0;
    const own: Span = { top: box.top - top + raised, bottom: box.bottom - top + raised };
    const pieces: Span[] = Array.from(frame.querySelectorAll<HTMLElement>('[data-lock-piece]')).map((piece) => {
      const r = piece.getBoundingClientRect();
      return { top: r.top - top, bottom: r.bottom - top };
    });
    const ceiling = (ceilingRef.current?.getBoundingClientRect().top ?? top) - top + 8;
    // Whole pixels, and only a real move: the card's own measurements carry
    // fractions, so a lift worked out from where the last lift put it could
    // differ by a hair every draw and set itself forever (React error 185 on them
    // phone, Nov 7 2026, the night the Script face came in).
    const raw = liftLockCard(own, pieces, ceiling);
    const next = raw === null ? null : Math.round(raw);
    if (next === lift) return;
    if (typeof next === 'number' && typeof lift === 'number' && Math.abs(next - lift) < 2) return;
    // And a hard stop: if it has moved more than a few times in a breath it is
    // chasing itself, so it stays where it is until the next second's draw.
    const now = Date.now();
    const moves = moved.current;
    if (now - moves.since > 1000) { moves.since = now; moves.count = 0; }
    if (++moves.count > 6) return;
    setLift(next);
  });

  const view = lockSpotifyTrack(state);
  // Before the first read lands there is nothing to say yet; after it, nothing
  // playing is still a card (the quiet line).
  if (!view && state.read === null) return null;
  if (placed) {
    const pressPlaced: PressState = {
      pressing: state.pressing,
      notice: state.notice,
      onPress: (what, where) => void lock.keeper.press(what, where),
    };
    return (
      <div data-lock-spotify="">
        <LockSpotifyCardView view={view} press={pressPlaced} onOpen={onOpen} look={look} shape={shape} backs={backs} compact />
      </div>
    );
  }
  const away = lift === undefined || lift === null;
  const press: PressState = {
    pressing: state.pressing,
    notice: state.notice,
    onPress: (what, where) => void lock.keeper.press(what, where),
  };
  return (
    <>
      <div ref={ceilingRef} aria-hidden className="pointer-events-none absolute inset-x-0 h-0" style={{ top: 'var(--sat, 0px)' }} />
      <div
        ref={ref}
        data-lock-spotify=""
        aria-hidden={away || undefined}
        className="absolute inset-x-5 z-20"
        style={{ bottom: `calc(var(--sab, 0px) + ${base + (lift ?? 0)}px)`, visibility: away ? 'hidden' : undefined }}
      >
        <LockSpotifyCardView view={view} press={press} onOpen={onOpen} look={look} shape={shape} />
      </div>
    </>
  );
}
