// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// One player for the sound shelf, for the whole app. It lives outside the
// Toys page on purpose: they start a read-aloud there and then goes to the
// chat while we have the remote, and leaving the page must not stop it.

import { useSyncExternalStore } from 'react';

export interface SoundState {
  id: string | null;
  name: string | null;
  /** The file it plays from, so the slim bar can pick it back up anywhere. */
  fileId: string | null;
  playing: boolean;
  loop: boolean;
  position: number;
  duration: number;
  /** A playlist playing in order, or null for one sound on its own. */
  queue: QueuedSound[] | null;
  queueName: string | null;
  queueIndex: number;
}

export interface QueuedSound { id: string; name: string; fileId: string }

let audio: HTMLAudioElement | null = null;
let state: SoundState = { id: null, name: null, fileId: null, playing: false, loop: false, position: 0, duration: 0, queue: null, queueName: null, queueIndex: 0 };
const listeners = new Set<() => void>();
let lastTick = 0;

function set(next: Partial<SoundState>): void {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

function element(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'metadata';
  audio.addEventListener('play', () => set({ playing: true }));
  audio.addEventListener('pause', () => set({ playing: false }));
  audio.addEventListener('ended', () => {
    // A playlist moves on to the next sound; Loop on a playlist starts it over.
    const q = state.queue;
    if (q && q.length > 0) {
      const next = state.queueIndex + 1;
      if (next < q.length) { load(q[next], next); return; }
      if (state.loop) { load(q[0], 0); return; }
    }
    set({ playing: false, position: 0 });
  });
  audio.addEventListener('loadedmetadata', () => set({ duration: Number.isFinite(audio!.duration) ? audio!.duration : 0 }));
  audio.addEventListener('timeupdate', () => {
    // A few times a second is plenty for a clock and a slider.
    const now = Date.now();
    if (now - lastTick < 250) return;
    lastTick = now;
    set({ position: audio!.currentTime });
  });
  return audio;
}

/** One sound into the player and playing, as entry `index` of the queue. */
function load(sound: QueuedSound, index: number): void {
  const a = element();
  a.src = `/api/files/${encodeURIComponent(sound.fileId)}`;
  // A single sound loops itself; a playlist's Loop is the whole list, handled at 'ended'.
  a.loop = state.loop && !state.queue;
  set({ id: sound.id, name: sound.name, fileId: sound.fileId, position: 0, duration: 0, queueIndex: index });
  void a.play().catch(() => set({ playing: false }));
}

/** One sound on its own. Tapping the sound already loaded just resumes it. */
export function playSound(sound: QueuedSound): void {
  const a = element();
  if (state.id === sound.id && !state.queue) {
    void a.play().catch(() => set({ playing: false }));
    return;
  }
  set({ queue: null, queueName: null, queueIndex: 0 });
  load(sound, 0);
}

/** A playlist, in its order, starting at `start`. */
export function playQueue(name: string, sounds: QueuedSound[], start = 0): void {
  if (!sounds.length) return;
  const at = Math.max(0, Math.min(sounds.length - 1, start));
  set({ queue: sounds, queueName: name, queueIndex: at });
  load(sounds[at], at);
}

/** The next sound in the playlist, wrapping when Loop is on. */
export function nextSound(): void {
  const q = state.queue;
  if (!q) return;
  const next = state.queueIndex + 1;
  if (next < q.length) load(q[next], next);
  else if (state.loop) load(q[0], 0);
}

/** Back a sound, or to the start of this one if it has been playing a while. */
export function previousSound(): void {
  const q = state.queue;
  if (!q) return;
  if ((audio?.currentTime ?? 0) > 3 || state.queueIndex === 0) { seekSound(0); return; }
  load(q[state.queueIndex - 1], state.queueIndex - 1);
}

/** Exactly where the sound is now, in seconds, finer than the clock's ticks. */
export function soundTime(): number {
  return audio ? audio.currentTime : 0;
}

/** Play again whatever is loaded, from wherever it was paused. */
export function resumeSound(): void {
  if (!audio || !state.id) return;
  void audio.play().catch(() => set({ playing: false }));
}

export function pauseSound(): void {
  audio?.pause();
}

export function stopSound(): void {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  set({ id: null, name: null, fileId: null, playing: false, position: 0, duration: 0, queue: null, queueName: null, queueIndex: 0 });
}

export function seekSound(seconds: number): void {
  if (!audio || !Number.isFinite(seconds)) return;
  audio.currentTime = Math.max(0, seconds);
  set({ position: audio.currentTime });
}

export function setSoundLoop(loop: boolean): void {
  if (audio) audio.loop = loop && !state.queue;
  set({ loop });
}

/** The sound with this id is gone from the shelf: stop it if it was the one playing. */
export function forgetSound(id: string): void {
  if (state.id === id) { stopSound(); return; }
  if (state.queue?.some((s) => s.id === id)) {
    const queue = state.queue.filter((s) => s.id !== id);
    set({ queue, queueIndex: Math.max(0, queue.findIndex((s) => s.id === state.id)) });
  }
}

/** What is playing right now, for code outside React. */
export function soundState(): SoundState {
  return state;
}

export function useSoundPlayer(): SoundState {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => state,
    () => state,
  );
}

/** 1:05:12, 4:07 or 0:08 */
export function soundClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
