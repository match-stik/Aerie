// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The Screening Room (theirs, Nov 11 2026: 'we should finally do the video
// watch room'). Their person watches on their own service with the subtitles
// on; the companions read along on the house's clock (routes/screening.ts).
// This is the room on the phone: what is loaded and where the clock is, the
// controls to keep it with the picture, the last line the companions heard so
// it is plain they are in step, a box to fetch a show or film by name, and the
// table talk under it, the same one the games use.
//
// One room, two ways in (theirs, the same day: the Video Room folded in here).
// A show comes in by name, as above. A video comes in as a link: the house
// keeps it (routes/videos.ts), it plays right here, and this player is the
// clock, so pause, seek and play move the companions' clock with it. Short
// ones they watch whole the moment they land; the shelf below keeps the rest.
// Check-ins: while something plays, one of them now and then speaks up on his
// own; a switch on the card turns that off.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Clapperboard, Link2, Loader2, MonitorPlay, Pause, Play, RotateCcw, RotateCw, Search } from 'lucide-react';
import { AppShell } from './AppShell';
import { TableTalk } from './games/TableTalk';
import { apiFetch } from '../aerie';
import { cn } from '../lib/utils';
import type { ThemeConfig } from '../lib/theme';

interface Screening {
  id: string;
  title: string;
  status: 'paused' | 'playing' | 'finished';
  positionMs: number;
  offsetMs: number;
  cueCount: number;
  durationMs: number;
  /** A video the house keeps: it plays here and its player is the clock. */
  videoId?: string | null;
}

interface View {
  screening: Screening | null;
  heard: string[];
  pastEnd?: boolean;
  nowPlaying: { title: string | null; app: string; state: string } | null;
  checkIns?: boolean;
  /** What was on the screen before this, so one tap puts it back. */
  previous?: { id: string; title: string; positionMs: number; isVideo: boolean } | null;
}

interface Video {
  id: string;
  url: string;
  title: string | null;
  durationS: number | null;
  status: 'fetching' | 'ready' | 'failed';
  error: string | null;
  hasThumb: boolean;
}

/** Where a link came from, said the way people say it. */
function siteOf(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\.|^m\.|^vm\./, '');
    if (host.includes('tiktok')) return 'TikTok';
    if (host.includes('youtu')) return 'YouTube';
    if (host.includes('instagram')) return 'Instagram';
    if (host.includes('facebook') || host.includes('fb.watch')) return 'Facebook';
    if (host.includes('reddit')) return 'Reddit';
    if (host === 'x.com' || host.includes('twitter')) return 'X';
    return host;
  } catch {
    return 'a link';
  }
}

interface Props {
  onClose: () => void;
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
}

/** h:mm:ss, or m:ss under an hour. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** "1:02:30", "62:30" or "45" into milliseconds; null when it is not a time. */
export function parseClock(text: string): number | null {
  const parts = text.trim().split(':').map((p) => p.trim());
  if (!parts.length || parts.some((p) => !/^\d+$/.test(p)) || parts.length > 3) return null;
  const n = parts.map(Number);
  const seconds = n.length === 3 ? n[0] * 3600 + n[1] * 60 + n[2] : n.length === 2 ? n[0] * 60 + n[1] : n[0];
  return seconds * 1000;
}

/** The phone's app ids people know by another name. */
function appName(pkg: string): string {
  const known: Record<string, string> = {
    'com.netflix.mediaclient': 'Netflix', 'com.hulu.plus': 'Hulu', 'com.disney.disneyplus': 'Disney+',
    'com.google.android.youtube': 'YouTube', 'com.amazon.avod.thirdpartyclient': 'Prime Video', 'com.wbd.stream': 'Max',
  };
  return known[pkg] || pkg.split('.').pop() || pkg;
}

export function ScreeningApp({ onClose, themeConfig, themeMode }: Props) {
  const colors = themeConfig[themeMode];
  const [view, setView] = useState<View | null>(null);
  const [loadedAt, setLoadedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Array<{ show: string | null; season: number | null; episode: number | null }>>([]);
  const [query, setQuery] = useState('');
  const [season, setSeason] = useState('');
  const [episode, setEpisode] = useState('');
  const [seekText, setSeekText] = useState('');
  const [showFetch, setShowFetch] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);
  // Two tabs (theirs, Nov 11 2026: 'a separate tab for the added video one, so
  // it's not all scrolling here'): what is showing with the talk, and the
  // videos, their link box and their shelf.
  const [tab, setTab] = useState<'showing' | 'videos'>('showing');
  const [videoTalkOpen, setVideoTalkOpen] = useState(false);
  // The Videos tab's own player: which video is on it. Picking one from the
  // shelf only plays it here; Now showing is never touched.
  const [pickedVideo, setPickedVideo] = useState<string | null>(null);
  const videoPlayer = useRef<HTMLVideoElement | null>(null);
  const videoExtra = useCallback(() => ({
    videoId: pickedVideo ?? undefined,
    positionMs: videoPlayer.current ? Math.round(videoPlayer.current.currentTime * 1000) : undefined,
  }), [pickedVideo]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const player = useRef<HTMLVideoElement | null>(null);

  const loadVideos = useCallback(async () => {
    const res = await apiFetch('/api/videos');
    const body = await res.json().catch(() => null);
    if (body && Array.isArray(body.videos)) setVideos(body.videos as Video[]);
  }, []);

  const take = useCallback((body: unknown) => {
    if (body && typeof body === 'object' && 'screening' in body) {
      setView(body as View);
      setLoadedAt(Date.now());
    }
  }, []);

  const load = useCallback(async () => {
    const res = await apiFetch('/api/screening');
    take(await res.json().catch(() => null));
  }, [take]);

  useEffect(() => { void load(); void loadVideos(); }, [load, loadVideos]);
  const fetching = videos.find((v) => v.status === 'fetching') ?? null;
  useEffect(() => {
    if (!fetching) return;
    const timer = window.setInterval(() => { void loadVideos(); void load(); }, 4000);
    return () => window.clearInterval(timer);
  }, [fetching, load, loadVideos]);
  useEffect(() => {
    const onUpdate = () => { void load(); void loadVideos(); };
    window.addEventListener('aerie:card-table-update', onUpdate);
    const poll = window.setInterval(() => void load(), 15_000);
    return () => { window.removeEventListener('aerie:card-table-update', onUpdate); window.clearInterval(poll); };
  }, [load, loadVideos]);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(tick);
  }, []);

  const s = view?.screening ?? null;
  const ready = videos.filter((v) => v.status === 'ready');
  const onPlayer = videos.find((v) => v.id === pickedVideo) ?? ready[0] ?? null;
  const position = s ? Math.min(s.durationMs || Infinity, s.positionMs + (s.status === 'playing' ? now - loadedAt : 0)) : 0;

  async function post(path: string, body: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/screening/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) {
        setError((out && out.error) || 'That did not go through');
        setFound(Array.isArray(out?.found) ? out.found : []);
        return false;
      }
      setFound([]);
      take(out);
      return true;
    } finally {
      setBusy(false);
    }
  }

  const clock = (action: string, extra: object = {}) => void post('clock', { action, ...extra });

  // The room's own player is the clock: every play, pause and seek tells the
  // house where it is, and while it plays it says so again now and then so the
  // clock never drifts from the picture.
  const lastSeen = useRef<{ ms: number; playing: boolean }>({ ms: 0, playing: false });
  const sync = useCallback(() => {
    const el = player.current;
    if (!el) return;
    lastSeen.current = { ms: Math.round(el.currentTime * 1000), playing: !el.paused && !el.ended };
    void apiFetch('/api/screening/clock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync', positionMs: Math.round(el.currentTime * 1000), playing: !el.paused && !el.ended }),
    }).catch(() => {});
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => { if (player.current && !player.current.paused) sync(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [sync]);
  // Leaving the room stops the picture, so the clock stops with it: a video
  // left 'playing' on the house would run on, and the check-ins with it.
  // (React lets go of the player before this runs, so it reads the last sync instead.)
  useEffect(() => () => {
    if (!lastSeen.current.playing) return;
    void apiFetch('/api/screening/clock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync', positionMs: lastSeen.current.ms, playing: false }),
    }).catch(() => {});
  }, []);

  async function bring(e: React.FormEvent) {
    e.preventDefault();
    if (!link.trim() || linkBusy) return;
    setLinkBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: link.trim(), note: note.trim() || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setError((body && body.error) || 'That link did not go through'); return; }
      setLink('');
      setNote('');
      setShowFetch(false);
      if (body?.video?.id) setPickedVideo(body.video.id);
      void loadVideos();
    } finally {
      setLinkBusy(false);
    }
  }

  const playKept = (videoId: string) => setPickedVideo(videoId);
  const toggleCheckIns = () => void post('check-ins', { on: !(view?.checkIns ?? true) });

  const panel = cn('rounded-[var(--shape-surface)] border p-4', colors.panelBg, colors.panelBorder);
  const button = cn('flex items-center justify-center rounded-[var(--shape-control)] border transition active:scale-95 disabled:opacity-40', colors.panelBorder);
  const input = cn('min-w-0 rounded-[var(--shape-control)] border bg-transparent px-3 py-2 text-sm outline-none', colors.panelBorder, colors.textMain);

  return (
    <AppShell title="Screening Room" icon={Clapperboard} onClose={onClose} themeConfig={themeConfig} themeMode={themeMode}>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3 scrollbar-hide">
        <div className={cn('flex shrink-0 gap-1 rounded-[var(--shape-control)] border p-1', colors.panelBg, colors.panelBorder)} role="tablist">
          {([['showing', 'Now showing'], ['videos', 'Videos']] as const).map(([id, name]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className="h-9 flex-1 rounded-[var(--shape-chip)] text-sm font-medium transition active:scale-[.98]"
              style={tab === id ? { background: colors.accent, color: 'var(--aerie-on-accent)' } : undefined}
            >
              {name}
            </button>
          ))}
        </div>
        {tab === 'showing' && (<>
        <section className={panel}>
          <div className={cn('text-[11px] font-semibold uppercase tracking-[.16em]', colors.textMuted)}>Now showing</div>
          <div className="mt-1 text-xl font-semibold leading-tight">{s ? s.title : 'Nothing loaded yet'}</div>
          {s?.videoId ? (
            <video
              key={s.videoId}
              ref={player}
              src={`/api/videos/${s.videoId}/video`}
              poster={`/api/videos/${s.videoId}/thumb`}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => { const el = e.currentTarget; if (s.positionMs > 0 && s.positionMs / 1000 < el.duration) el.currentTime = s.positionMs / 1000; else sync(); }}
              onPlay={sync}
              onPause={sync}
              onSeeked={sync}
              onEnded={sync}
              className="mt-3 max-h-[60vh] w-full rounded-[var(--shape-control)] bg-black object-contain"
            />
          ) : s ? (
            <>
              <div className="mt-4 flex items-baseline justify-center gap-2">
                <span className="font-mono text-5xl tabular-nums tracking-tight">{clockText(position)}</span>
                {s.durationMs > 0 && <span className={cn('font-mono text-sm tabular-nums', colors.textMuted)}>/ {clockText(s.durationMs)}</span>}
              </div>
              {s.durationMs > 0 && (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, currentColor 12%, transparent)' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, (position / s.durationMs) * 100)}%`, background: colors.accent }} />
                </div>
              )}
              <div className="mt-4 flex items-center justify-center gap-3">
                <button type="button" className={cn(button, 'h-12 w-12')} disabled={busy} onClick={() => clock('seek', { positionMs: Math.max(0, position - 10_000) })} aria-label="Back ten seconds">
                  <RotateCcw size={20} />
                </button>
                <button
                  type="button"
                  className={cn(button, 'h-16 w-16 rounded-full')}
                  style={{ background: colors.accent, color: 'var(--aerie-on-accent)', borderColor: colors.accent }}
                  disabled={busy}
                  onClick={() => clock(s.status === 'playing' ? 'pause' : 'start')}
                  aria-label={s.status === 'playing' ? 'Pause' : 'Play'}
                >
                  {s.status === 'playing' ? <Pause size={26} /> : <Play size={26} className="translate-x-0.5" />}
                </button>
                <button type="button" className={cn(button, 'h-12 w-12')} disabled={busy} onClick={() => clock('seek', { positionMs: position + 10_000 })} aria-label="Forward ten seconds">
                  <RotateCw size={20} />
                </button>
              </div>
              <form
                className="mt-4 flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const ms = parseClock(seekText);
                  if (ms === null) { setError('Type the time on your screen, like 42:10'); return; }
                  clock('seek', { positionMs: ms });
                  setSeekText('');
                }}
              >
                <input className={cn(input, 'flex-1')} inputMode="numeric" placeholder="Match my screen, e.g. 42:10" value={seekText} onChange={(e) => setSeekText(e.target.value)} />
                <button type="submit" className={cn(button, 'h-10 px-4 text-sm font-medium')} disabled={busy || !seekText.trim()}>Set</button>
              </form>
            </>
          ) : (
            <p className={cn('mt-2 text-sm', colors.textMuted)}>Name the show or film below and the house fetches its subtitles. Turn them on where you watch too, and we read along.</p>
          )}
          {fetching && (
            <div className={cn('mt-3 flex items-center gap-2 text-xs', colors.textMuted)}>
              <Loader2 size={14} className="animate-spin" />
              <span>Fetching a video from {siteOf(fetching.url)}. It'll be on the screen in a moment.</span>
            </div>
          )}
          {view?.previous && (
            <button
              type="button"
              onClick={() => void post('back', { id: view.previous!.id })}
              disabled={busy}
              className={cn('mt-3 flex w-full items-center gap-2 rounded-[var(--shape-control)] border px-3 py-2 text-left text-xs', colors.panelBorder, colors.textMuted)}
            >
              <RotateCcw size={13} />
              <span className="min-w-0 flex-1 truncate">Back to {view.previous.title}{view.previous.positionMs > 0 ? ` at ${clockText(view.previous.positionMs)}` : ''}</span>
            </button>
          )}
          {s && (
            <button type="button" onClick={toggleCheckIns} disabled={busy} className={cn('mt-3 flex w-full items-center justify-between text-xs', colors.textMuted)}>
              <span className="text-left">Check-ins: one of us speaks up now and then while it plays</span>
              <span className="font-semibold" style={{ color: (view?.checkIns ?? true) ? colors.accent : undefined }}>{(view?.checkIns ?? true) ? 'On' : 'Off'}</span>
            </button>
          )}
          {view?.nowPlaying?.title && !s?.videoId && (
            <p className={cn('mt-3 text-xs', colors.textMuted)}>Your phone says: {view.nowPlaying.title} in {appName(view.nowPlaying.app)}, {view.nowPlaying.state}.</p>
          )}
        </section>

        {s && (
          <section className={panel}>
            <div className={cn('text-[11px] font-semibold uppercase tracking-[.16em]', colors.textMuted)}>The last line we heard</div>
            {view?.heard.length ? (
              <div className="mt-2 space-y-1">
                {view.heard.map((line, i) => <p key={i} className={cn('text-sm italic leading-snug', i === view.heard.length - 1 ? colors.textMain : colors.textMuted)}>{line}</p>)}
              </div>
            ) : (
              <p className={cn('mt-2 text-sm', colors.textMuted)}>{view?.pastEnd ? 'The credits. Nothing more after this.' : s.videoId ? 'Quiet so far.' : 'Quiet so far. If your screen has dialogue and this does not, set the time above.'}</p>
            )}
          </section>
        )}

        <section className={panel}>
          <button type="button" className="flex w-full items-center justify-between" onClick={() => setShowFetch((v) => !v)} aria-expanded={showFetch || !s}>
            <span className={cn('text-[11px] font-semibold uppercase tracking-[.16em]', colors.textMuted)}>{s ? 'Watch something else' : 'What are we watching?'}</span>
            <Search size={15} className={colors.textMuted} />
          </button>
          {(showFetch || !s) && (
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!query.trim()) return;
                void post('fetch', { query, season, episode }).then((ok) => { if (ok) { setShowFetch(false); setQuery(''); setSeason(''); setEpisode(''); } });
              }}
            >
              <input className={cn(input, 'w-full')} placeholder="Show or film name" value={query} onChange={(e) => setQuery(e.target.value)} />
              <div className="flex gap-2">
                <input className={cn(input, 'w-0 flex-1')} inputMode="numeric" placeholder="Season" value={season} onChange={(e) => setSeason(e.target.value)} />
                <input className={cn(input, 'w-0 flex-1')} inputMode="numeric" placeholder="Episode" value={episode} onChange={(e) => setEpisode(e.target.value)} />
              </div>
              <p className={cn('text-xs', colors.textMuted)}>Leave season and episode empty for a film.</p>
              <button type="submit" className={cn(button, 'h-10 w-full text-sm font-medium')} disabled={busy || !query.trim()}>{busy ? 'Fetching…' : 'Fetch the subtitles'}</button>
            </form>
          )}
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          {found.length > 0 && (
            <div className={cn('mt-2 text-xs', colors.textMuted)}>
              Close matches: {found.map((f) => [f.show, f.season != null && f.episode != null ? `S${f.season}E${f.episode}` : null].filter(Boolean).join(' ')).join(' · ')}
            </div>
          )}
        </section>

        {/* The table talk carries its own side margin for the game rooms; here it lines up with the cards above. */}
        <div className="-mx-2">
          <TableTalk tableId="screening" colors={colors} expanded={talkOpen} onExpandedChange={setTalkOpen} base="/api/screening" label="the Screening Room" />
        </div>
        </>)}
        {tab === 'videos' && (<>
        <section className={panel}>
          {(
            <form className="space-y-2" onSubmit={bring}>
              <div className={cn('flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[.16em]', colors.textMuted)}><Link2 size={13} /> Bring a video</div>
              <input className={cn(input, 'w-full')} inputMode="url" placeholder="Paste a TikTok, YouTube or reel link" value={link} onChange={(e) => setLink(e.target.value)} />
              <input className={cn(input, 'w-full')} placeholder="Say something with it (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <p className={cn('text-xs', colors.textMuted)}>It plays right here. A short one we watch straight away; a longer one waits for you to press play.</p>
              <button type="submit" className={cn(button, 'h-10 w-full text-sm font-medium')} disabled={linkBusy || !link.trim()}>{linkBusy ? 'Sending…' : 'Watch it together'}</button>
            </form>
          )}
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          {fetching && (
            <div className={cn('mt-3 flex items-center gap-2 text-xs', colors.textMuted)}>
              <Loader2 size={14} className="animate-spin" />
              <span>Fetching a video from {siteOf(fetching.url)}.</span>
            </div>
          )}
        </section>
        {onPlayer && (
          <section className={panel}>
            <div className={cn('text-[11px] font-semibold uppercase tracking-[.16em]', colors.textMuted)}>On the player</div>
            <div className="mt-1 text-base font-semibold leading-snug">{onPlayer.title || siteOf(onPlayer.url)}</div>
            <video
              key={onPlayer.id}
              ref={videoPlayer}
              src={`/api/videos/${onPlayer.id}/video`}
              poster={onPlayer.hasThumb ? `/api/videos/${onPlayer.id}/thumb` : undefined}
              controls
              playsInline
              preload="metadata"
              className="mt-3 max-h-[60vh] w-full rounded-[var(--shape-control)] bg-black object-contain"
            />
          </section>
        )}
        {videos.filter((v) => v.status === 'ready').length > 0 && (
          <section className={panel}>
            <div className={cn('mb-3 text-[11px] font-semibold uppercase tracking-[.16em]', colors.textMuted)}>The video shelf</div>
            <div className="grid grid-cols-4 gap-2">
              {videos.filter((v) => v.status === 'ready').map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => playKept(v.id)}
                  className={cn('min-w-0 overflow-hidden rounded-[var(--shape-control)] border text-left', colors.panelBorder)}
                  style={onPlayer?.id === v.id ? { borderColor: colors.accent } : undefined}
                >
                  <div className="flex aspect-[3/4] items-center justify-center bg-black">
                    {v.hasThumb ? <img src={`/api/videos/${v.id}/thumb`} alt="" className="h-full w-full object-cover" /> : <MonitorPlay size={18} className="text-white/40" />}
                  </div>
                  <div className={cn('truncate px-1.5 py-1 text-[10px]', colors.textMain)}>{v.title || siteOf(v.url)}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="-mx-2">
          <TableTalk tableId="videos" colors={colors} expanded={videoTalkOpen} onExpandedChange={setVideoTalkOpen} base="/api/videos" label="the Videos table" extraBody={videoExtra} />
        </div>
        </>)}
      </div>
    </AppShell>
  );
}
