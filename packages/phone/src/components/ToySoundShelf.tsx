// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The sound shelf on the Toys page: their audio, read-alouds and anything else
// they like, uploaded once and played from here while the remote is handed
// over or while they play on their own (theirs, Nov 9 2026). The player is
// lib/sound-player.ts, one for the whole app, so leaving the page does not
// stop what is playing. The audio lives in the house's file store, and
// services/toy-sounds.ts on the house keeps the shelf.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ListMusic, Pause, Pencil, Play, Plus, Repeat, SkipBack, SkipForward, Square, Trash2, Waves } from 'lucide-react';
import { api, apiFetch } from '../aerie/api';
import { setSoundDrive, useSoundDrive } from '../aerie/sound-drive';
import { hasToyBridge } from '../aerie/lovense-toys';
import { forgetSound, nextSound, pauseSound, playQueue, playSound, previousSound, resumeSound, seekSound, setSoundLoop, soundClock, stopSound, useSoundPlayer } from '../lib/sound-player';
import { cn } from '../lib/utils';

interface Sound {
  id: string;
  name: string;
  fileId: string;
  size: number;
  createdAt: string;
}

interface Playlist {
  id: string;
  name: string;
  soundIds: string[];
  createdAt: string;
}

/** A playlist being made or changed: their picks, in the order they tapped them. */
interface Building {
  id: string | null;
  name: string;
  ids: string[];
}

interface Props {
  accentHex: string;
  panelClass: string;
  textMain: string;
  textMuted: string;
  panelBorder: string;
}

const OPEN_KEY = 'aerie.toys.soundsOpen';
// MIME types first, bare extensions behind them: a list of extensions alone
// makes the Android WebView drop to the document chooser.
const ACCEPT = 'audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg,audio/webm,.mp3,.m4a,.wav,.ogg';

function megabytes(size: number): string {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

export function ToySoundShelf({ accentHex, panelClass, textMain, textMuted, panelBorder }: Props) {
  const player = useSoundPlayer();
  const drive = useSoundDrive();
  const [sounds, setSounds] = useState<Sound[] | null>(null);
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(OPEN_KEY) !== 'closed'; } catch { return true; }
  });
  const [uploading, setUploading] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [building, setBuilding] = useState<Building | null>(null);
  const [renamingList, setRenamingList] = useState<string | null>(null);
  const [confirmDeleteList, setConfirmDeleteList] = useState<string | null>(null);

  const loadPlaylists = useCallback(async () => {
    try {
      const res = await api.get('/api/toys/sound-playlists');
      if (!(res.headers.get('content-type') || '').includes('json')) { setPlaylists(null); return; }
      const body = await res.json();
      setPlaylists(Array.isArray(body?.playlists) ? (body.playlists as Playlist[]) : []);
    } catch {
      setPlaylists(null);
    }
  }, []);

  useEffect(() => { void loadPlaylists(); }, [loadPlaylists]);

  const soundsOf = (list: Playlist): Sound[] => {
    const byId = new Map((sounds ?? []).map((x) => [x.id, x] as const));
    return list.soundIds.map((id) => byId.get(id)).filter((x): x is Sound => !!x);
  };

  const playList = (list: Playlist) => {
    const queue = soundsOf(list).map((x) => ({ id: x.id, name: x.name, fileId: x.fileId }));
    if (queue.length) playQueue(list.name, queue);
  };

  const togglePickSound = (id: string) => {
    setBuilding((b) => (b ? { ...b, ids: b.ids.includes(id) ? b.ids.filter((x) => x !== id) : [...b.ids, id] } : b));
  };

  const saveBuilding = async () => {
    if (!building || building.ids.length === 0) return;
    const name = building.name.replace(/\s+/g, ' ').trim() || `Playlist ${(playlists?.length ?? 0) + 1}`;
    const res = building.id
      ? await api.patch(`/api/toys/sound-playlists/${encodeURIComponent(building.id)}`, { name, soundIds: building.ids }).catch(() => null)
      : await api.post('/api/toys/sound-playlists', { name, soundIds: building.ids }).catch(() => null);
    if (!res?.ok) {
      setNote('That playlist did not save. Try again.');
      return;
    }
    setBuilding(null);
    void loadPlaylists();
  };

  const renameList = async (list: Playlist, value: string) => {
    setRenamingList(null);
    const name = value.replace(/\s+/g, ' ').trim();
    if (!name || name === list.name) return;
    const res = await api.patch(`/api/toys/sound-playlists/${encodeURIComponent(list.id)}`, { name }).catch(() => null);
    if (res?.ok) setPlaylists((prev) => (prev ?? []).map((x) => (x.id === list.id ? { ...x, name } : x)));
    else setNote('That name would not take. Try again.');
  };

  const removeList = async (list: Playlist) => {
    if (confirmDeleteList !== list.id) { setConfirmDeleteList(list.id); return; }
    setConfirmDeleteList(null);
    const res = await api.delete(`/api/toys/sound-playlists/${encodeURIComponent(list.id)}`).catch(() => null);
    if (res?.ok) setPlaylists((prev) => (prev ?? []).filter((x) => x.id !== list.id));
    else setNote('That playlist would not clear. Try again.');
  };

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/toys/sounds');
      if (!(res.headers.get('content-type') || '').includes('json')) {
        setSounds([]);
        setNote('The sound shelf arrives with the next house restart.');
        return;
      }
      const body = await res.json();
      setSounds(Array.isArray(body?.sounds) ? (body.sounds as Sound[]) : []);
    } catch {
      setSounds([]);
      setNote('The sounds did not load. Is the house reachable?');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(OPEN_KEY, next ? 'open' : 'closed'); } catch { /* not remembered */ }
      return next;
    });
  };

  const upload = async (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setNote(null);
    for (const file of list) {
      setUploading(file.name);
      try {
        const form = new FormData();
        form.append('file', file, file.name);
        const res = await apiFetch('/api/toys/sounds', { method: 'POST', body: form });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.sound) {
          setNote(body?.error || `${file.name} did not upload.`);
          continue;
        }
        setSounds((prev) => [body.sound as Sound, ...(prev ?? [])]);
      } catch {
        setNote(`${file.name} did not upload. Is the house reachable?`);
      }
    }
    setUploading(null);
    if (picker.current) picker.current.value = '';
  };

  const rename = async (sound: Sound, value: string) => {
    setRenaming(null);
    const name = value.replace(/\s+/g, ' ').trim();
    if (!name || name === sound.name) return;
    const res = await api.patch(`/api/toys/sounds/${encodeURIComponent(sound.id)}`, { name }).catch(() => null);
    if (res?.ok) setSounds((prev) => (prev ?? []).map((s) => (s.id === sound.id ? { ...s, name } : s)));
    else setNote('That name would not take. Try again.');
  };

  const remove = async (sound: Sound) => {
    if (confirmDelete !== sound.id) {
      setConfirmDelete(sound.id);
      return;
    }
    setConfirmDelete(null);
    forgetSound(sound.id);
    const res = await api.delete(`/api/toys/sounds/${encodeURIComponent(sound.id)}`).catch(() => null);
    if (res?.ok) {
      setSounds((prev) => (prev ?? []).filter((s) => s.id !== sound.id));
      void loadPlaylists();
    } else setNote('That one would not clear. Try again.');
  };

  return (
    <div className={cn(panelClass, 'flex flex-col gap-3 p-4')}>
      <div className="flex items-center justify-between gap-2">
        <button onClick={toggleOpen} className={cn('flex items-center gap-1.5 text-sm font-medium', textMain)} aria-expanded={open}>
          <ChevronDown size={14} className={cn('transition-transform', !open && '-rotate-90')} />
          Sounds
          {!open && sounds && sounds.length > 0 && <span className={cn('text-xs font-normal', textMuted)}>({sounds.length})</span>}
        </button>
        <div className="flex items-center gap-1.5">
        {playlists !== null && sounds && sounds.length > 0 && !building && (
          <button
            onClick={() => { setBuilding({ id: null, name: '', ids: [] }); if (!open) toggleOpen(); }}
            className={cn('flex items-center gap-1 rounded-[var(--shape-control)] border px-2.5 py-1 text-xs', panelBorder, textMain)}
          >
            <ListMusic size={12} /> Playlist
          </button>
        )}
        <button
          onClick={() => picker.current?.click()}
          disabled={!!uploading}
          className={cn('flex items-center gap-1 rounded-[var(--shape-control)] border px-2.5 py-1 text-xs disabled:opacity-40', panelBorder, textMain)}
        >
          <Plus size={12} /> Add
        </button>
        </div>
        <input ref={picker} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
      </div>

      {/* What is playing stays in view even with the shelf folded up. */}
      {player.id && (
        <div className={cn('flex flex-col gap-2 rounded-[var(--shape-control)] border p-3', panelBorder)} style={{ borderColor: accentHex }}>
          <div className="flex items-center gap-2">
            <button
              onClick={() => (player.playing ? pauseSound() : resumeSound())}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
              style={{ background: accentHex, color: '#0b0a0f' }}
              aria-label={player.playing ? 'Pause' : 'Play'}
            >
              {player.playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
            </button>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cn('truncate text-sm', textMain)}>{player.name}</span>
              {player.queue && (
                <span className={cn('truncate text-[11px]', textMuted)}>
                  {player.queueName}, {player.queueIndex + 1} of {player.queue.length}
                </span>
              )}
            </span>
            {player.queue && player.queue.length > 1 && (
              <>
                <button onClick={previousSound} className={cn('rounded-[var(--shape-control)] border px-2 py-1 text-xs', panelBorder, textMuted)} aria-label="Previous sound">
                  <SkipBack size={12} />
                </button>
                <button onClick={nextSound} className={cn('rounded-[var(--shape-control)] border px-2 py-1 text-xs', panelBorder, textMuted)} aria-label="Next sound">
                  <SkipForward size={12} />
                </button>
              </>
            )}
            {hasToyBridge() && (
              <button
                onClick={() => setSoundDrive(!drive.on)}
                className={cn('rounded-[var(--shape-control)] border px-2 py-1 text-xs', panelBorder)}
                style={drive.on ? { borderColor: accentHex, color: accentHex } : undefined}
                aria-pressed={drive.on}
                aria-label="Let the sound drive the toys"
              >
                <Waves size={12} />
              </button>
            )}
            <button
              onClick={() => setSoundLoop(!player.loop)}
              className={cn('rounded-[var(--shape-control)] border px-2 py-1 text-xs', panelBorder)}
              style={player.loop ? { borderColor: accentHex, color: accentHex } : undefined}
              aria-pressed={player.loop}
              aria-label={player.queue ? 'Loop this playlist' : 'Loop this sound'}
            >
              <Repeat size={12} />
            </button>
            <button onClick={stopSound} className={cn('rounded-[var(--shape-control)] border px-2 py-1 text-xs', panelBorder, textMuted)} aria-label="Stop">
              <Square size={11} fill="currentColor" />
            </button>
          </div>
          {drive.on && (
            <span className={cn('text-[11px]', textMuted)}>{drive.problem ?? 'Your toys are following this sound.'}</span>
          )}
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.floor(player.duration))}
            value={Math.min(Math.floor(player.position), Math.max(1, Math.floor(player.duration)))}
            onChange={(e) => seekSound(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: accentHex }}
            aria-label="Where in the sound"
          />
          <div className={cn('flex justify-between text-[11px] tabular-nums', textMuted)}>
            <span>{soundClock(player.position)}</span>
            <span>{player.duration ? `${soundClock(Math.max(0, player.duration - player.position))} left` : ''}</span>
          </div>
        </div>
      )}

      {uploading && <p className={cn('text-xs', textMuted)}>Uploading {uploading}…</p>}

      {note && (
        <div className="flex items-start justify-between gap-3 text-xs">
          <span className={textMain}>{note}</span>
          <button onClick={() => setNote(null)} className={textMuted}>Dismiss</button>
        </div>
      )}

      {open && building && (
        <div className={cn('flex flex-col gap-2 rounded-[var(--shape-control)] border p-3', panelBorder)} style={{ borderColor: accentHex }}>
          <input
            value={building.name}
            onChange={(e) => setBuilding({ ...building, name: e.target.value })}
            maxLength={80}
            placeholder="Name it (optional)"
            className={cn('w-full rounded-[var(--shape-chip)] border bg-transparent px-2 py-1 text-sm outline-none', panelBorder, textMain)}
          />
          <span className={cn('text-[11px]', textMuted)}>
            {building.ids.length === 0
              ? 'Tap sounds below in the order you want them.'
              : `${building.ids.length} picked. Tap one again to take it out.`}
          </span>
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setBuilding(null)} className={cn('rounded-[var(--shape-control)] border px-2.5 py-1 text-xs', panelBorder, textMuted)}>Cancel</button>
            <button
              onClick={() => void saveBuilding()}
              disabled={building.ids.length === 0}
              className="rounded-[var(--shape-control)] px-2.5 py-1 text-xs font-medium disabled:opacity-40"
              style={{ background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' }}
            >
              {building.id ? 'Save changes' : 'Save playlist'}
            </button>
          </div>
        </div>
      )}

      {open && !building && playlists && playlists.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className={cn('text-[11px] uppercase tracking-wider', textMuted)}>Playlists</span>
          {playlists.map((list) => {
            const items = soundsOf(list);
            const on = player.queueName === list.name && !!player.queue && player.playing;
            return (
              <div key={list.id} className={cn('flex items-center gap-2.5 rounded-[var(--shape-control)] border px-2.5 py-2', panelBorder)} style={player.queue && player.queueName === list.name ? { borderColor: accentHex } : undefined}>
                <button
                  onClick={() => (on ? pauseSound() : playList(list))}
                  disabled={items.length === 0}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
                  style={on ? { background: accentHex, color: '#0b0a0f' } : { border: `1px solid ${accentHex}`, color: accentHex }}
                  aria-label={on ? `Pause ${list.name}` : `Play ${list.name}`}
                >
                  {on ? <Pause size={12} fill="currentColor" /> : <ListMusic size={13} />}
                </button>
                <div className="min-w-0 flex-1">
                  {renamingList === list.id ? (
                    <input
                      autoFocus
                      defaultValue={list.name}
                      maxLength={80}
                      onBlur={(e) => void renameList(list, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenamingList(null); }}
                      className={cn('w-full rounded-[var(--shape-chip)] border bg-transparent px-1.5 py-0.5 text-sm outline-none', panelBorder, textMain)}
                    />
                  ) : (
                    <button onClick={() => setRenamingList(list.id)} className={cn('block max-w-full truncate text-left text-sm', textMain)} title="Rename">
                      {list.name}
                    </button>
                  )}
                  <span className={cn('block truncate text-[11px]', textMuted)}>
                    {items.length === 1 ? '1 sound' : `${items.length} sounds`}{items.length ? `: ${items.map((x) => x.name).join(', ')}` : ''}
                  </span>
                </div>
                <button onClick={() => setBuilding({ id: list.id, name: list.name, ids: list.soundIds })} className={cn('shrink-0', textMuted)} aria-label={`Change ${list.name}`}>
                  <Pencil size={13} />
                </button>
                <button onClick={() => void removeList(list)} className={cn('shrink-0 text-[11px]', textMuted)} aria-label={`Clear ${list.name}`}>
                  {confirmDeleteList === list.id ? 'Sure?' : <Trash2 size={14} />}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <>
          {sounds === null && <p className={cn('text-xs', textMuted)}>Fetching your sounds…</p>}
          {sounds && sounds.length === 0 && !uploading && (
            <p className={cn('text-xs', textMuted)}>Nothing here yet. Add a read-aloud or anything you like, and it plays from here, even while you're in the chat.</p>
          )}
          {sounds && sounds.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {sounds.map((s) => {
                const on = player.id === s.id && player.playing;
                const order = building ? building.ids.indexOf(s.id) : -1;
                return (
                  <div key={s.id} className={cn('flex items-center gap-2.5 rounded-[var(--shape-control)] border px-2.5 py-2', panelBorder)} style={(building ? order >= 0 : player.id === s.id) ? { borderColor: accentHex } : undefined}>
                    {building ? (
                      <button
                        onClick={() => togglePickSound(s.id)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums"
                        style={order >= 0 ? { background: accentHex, color: '#0b0a0f' } : { border: `1px dashed ${accentHex}`, color: accentHex }}
                        aria-label={order >= 0 ? `Take ${s.name} out` : `Add ${s.name}`}
                      >
                        {order >= 0 ? order + 1 : <Plus size={13} />}
                      </button>
                    ) : (
                    <button
                      onClick={() => (on ? pauseSound() : playSound(s))}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                      style={on ? { background: accentHex, color: '#0b0a0f' } : { border: `1px solid ${accentHex}`, color: accentHex }}
                      aria-label={on ? `Pause ${s.name}` : `Play ${s.name}`}
                    >
                      {on ? <Pause size={12} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
                    </button>
                    )}
                    <div className="min-w-0 flex-1">
                      {renaming === s.id ? (
                        <input
                          autoFocus
                          defaultValue={s.name}
                          maxLength={80}
                          onBlur={(e) => void rename(s, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }}
                          className={cn('w-full rounded-[var(--shape-chip)] border bg-transparent px-1.5 py-0.5 text-sm outline-none', panelBorder, textMain)}
                        />
                      ) : (
                        <button onClick={() => setRenaming(s.id)} className={cn('block max-w-full truncate text-left text-sm', textMain)} title="Rename">
                          {s.name}
                        </button>
                      )}
                      <span className={cn('text-[11px]', textMuted)}>{megabytes(s.size)}</span>
                    </div>
                    <button onClick={() => void remove(s)} className={cn('shrink-0 text-[11px]', textMuted)} aria-label={`Clear ${s.name} off the shelf`}>
                      {confirmDelete === s.id ? 'Sure?' : <Trash2 size={14} />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
