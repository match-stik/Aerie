// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Lovense: this file drives Lovense toys. Running Aerie needs your own Lovense
// developer account and token; carrying this code into another project needs
// that project's own agreement and approval from Lovense. See
// packages/phone/android/LOVENSE.md.
// Toys: the owner's Lovense toys over Bluetooth from this phone, through the
// LovenseToys bridge (aerie/lovense-toys.ts) and Lovense's own SDK, with no
// Lovense Remote and no cloud in between.
//
// The stop is the first thing on the page and the biggest, and it is never
// disabled: whatever else is loading, waiting or broken, it can be pressed.
// While its hold runs the sliders are shut too, so nothing on this page looks
// like it is driving a toy when it is not.
//
// The owner can hand the companions the remote from here (aerie/toy-remote.ts).
// While a companion is playing, the line and the sliders show what they are
// doing in their color, any slider the owner moves takes that motor back, and
// the stop takes it all back.

import { rememberToyName, setToyName, toyName } from '../lib/toy-names';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, Bluetooth, Hand, Lightbulb, LoaderCircle, Search, Waves } from 'lucide-react';
import { AppShell } from './AppShell';
import { ToyWave, cssColorHex, mixHex, type LiveTrack } from './ToyWave';
import { ToyOrbs, type OrbMotor } from './ToyOrbs';
import type { WaveLook } from '../lib/pattern-wave';
import { ownerForCompanion } from '../lib/orb-field';
import { handOver, setHands, takeBack, useToyBatteries, useToyRemote, watchToyBatteries, yieldToOwner } from '../aerie/toy-remote';
import { noteToySearchStarted, onToyConnectEnded, startToyConnect, toyConnectPage, useToyConnects } from '../aerie/toy-connect';
import type { ThemeConfig } from '../lib/theme';
import { cn } from '../lib/utils';
import { useBackHandler } from '../lib/use-back-handler';
import {
  LovenseToys,
  handInToken,
  hasToyBridge,
  motorsFor,
  presetsFor,
  stopAllToys,
  type LovenseToy,
  type ToysStatus,
} from '../aerie/lovense-toys';

interface ToysAppProps {
  onClose: () => void;
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
}

/** Where the owner's pick of the line's look is kept between visits. */
const LOOK_KEY = 'aerie.toys.look';

/** How often a moving slider may send, per motor. The last value always goes. */
const SEND_EVERY_MS = 120;

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function isHeld(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'HELD';
}

/** The battery drawn by how full it is, not one icon for every level. */
function batteryIcon(level: number) {
  if (level >= 70) return <BatteryFull size={12} />;
  if (level >= 35) return <BatteryMedium size={12} />;
  if (level >= 15) return <BatteryLow size={12} />;
  return <BatteryWarning size={12} />;
}

export function ToysApp({ onClose, themeConfig, themeMode }: ToysAppProps) {
  const colors = themeConfig[themeMode];
  const panel = cn('rounded-2xl border backdrop-blur-md', colors.panelBg, colors.panelBorder);
  const onAccent = 'var(--aerie-on-accent)';
  const bridge = hasToyBridge();
  const remote = useToyRemote();
  // Each toy's own battery answer, never the SDK's field (aerie/toy-remote.ts).
  const batteries = useToyBatteries();

  const [status, setStatus] = useState<ToysStatus | null>(null);
  const [toys, setToys] = useState<Record<string, LovenseToy>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [searching, setSearching] = useState(false);
  // Each tap on Connect, followed to its end by the tracker (aerie/toy-connect.ts).
  const connects = useToyConnects();
  const [tokenProblem, setTokenProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [holdUntil, setHoldUntil] = useState(0);
  const [, setTick] = useState(0);
  const [orbsOpen, setOrbsOpen] = useState(false);
  // Back closes the Orbs screen and leaves the owner on the Toys page.
  useBackHandler(orbsOpen, () => setOrbsOpen(false));
  const [look, setLook] = useState<WaveLook>(() => {
    try {
      return localStorage.getItem(LOOK_KEY) === 'pure' ? 'pure' : 'starlit';
    } catch {
      return 'starlit';
    }
  });

  // While the orbs are open the owner's fingers drive, and no lane can.
  useEffect(() => {
    if (!orbsOpen) return;
    setHands(true);
    return () => setHands(false);
  }, [orbsOpen]);

  // Per motor: when it last sent, and the value waiting to go.
  const lastSent = useRef<Record<string, number>>({});
  const pending = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const holding = holdUntil > Date.now();

  // Re-render when the hold runs out, so the sliders open again on their own.
  useEffect(() => {
    if (!holding) return;
    const t = setTimeout(() => setTick((n) => n + 1), holdUntil - Date.now() + 20);
    return () => clearTimeout(t);
  }, [holding, holdUntil]);

  const mergeToys = useCallback((list: LovenseToy[]) => {
    setToys((prev) => {
      const next = { ...prev };
      for (const toy of list) {
        if (!toy?.toyId) continue;
        // An empty field in an update never wipes one we already had.
        const kept = Object.fromEntries(Object.entries(toy).filter(([, v]) => v !== '' && v !== null && v !== undefined));
        next[toy.toyId] = { ...prev[toy.toyId], ...kept, commands: toy.commands ?? prev[toy.toyId]?.commands ?? [] } as LovenseToy;
        rememberToyName(next[toy.toyId]);
      }
      return next;
    });
  }, []);

  const refreshToys = useCallback(async () => {
    try {
      const { toys: list } = await LovenseToys.toys();
      mergeToys(list);
    } catch (error) {
      setMessage(errorText(error));
    }
  }, [mergeToys]);

  const zeroAll = useCallback((toyId?: string) => {
    for (const key of Object.keys(pending.current)) {
      if (!toyId || key.startsWith(`${toyId}:`)) {
        clearTimeout(pending.current[key]);
        delete pending.current[key];
      }
    }
    setLevels((prev) => {
      const next: Record<string, number> = {};
      for (const [key, value] of Object.entries(prev)) {
        next[key] = !toyId || key.startsWith(`${toyId}:`) ? 0 : value;
      }
      return next;
    });
  }, []);

  // Wake the bridge: what it knows, the token from the house, and every event.
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    const handles: Promise<PluginListenerHandle>[] = [
      LovenseToys.addListener('toyFound', (toy) => mergeToys([toy])),
      LovenseToys.addListener('searchFinished', () => setSearching(false)),
      LovenseToys.addListener('connection', (c) => {
        if (c.state === 'failed') {
          setMessage('That toy would not connect. Is it on and close by?');
          zeroAll(c.toyId);
        }
        void refreshToys();
        // A toy says what it can do a beat after it connects. Its battery is
        // asked by the remote's battery watch once it has connected (theirs, Oct
        // 19 2026: the toy only volunteers it on its own schedule).
        setTimeout(() => { if (alive) void refreshToys(); }, 1200);
      }),
      LovenseToys.addListener('toyError', (e) => setMessage(e.message || 'The toy reported a problem.')),
      LovenseToys.addListener('stopped', (s) => {
        zeroAll();
        setHoldUntil(Date.now() + s.holdMs);
      }),
    ];
    (async () => {
      try {
        let current = await LovenseToys.status();
        if (!current.tokenSet) {
          const handed = await handInToken();
          if ('reason' in handed) setTokenProblem(handed.reason);
          else current = await LovenseToys.status();
        }
        if (!alive) return;
        setStatus(current);
        mergeToys(current.toys);
      } catch (error) {
        if (alive) setMessage(errorText(error));
      }
    })();
    return () => {
      alive = false;
      for (const h of handles) void h.then((handle) => handle.remove());
      for (const t of Object.values(pending.current)) clearTimeout(t);
    };
  }, [bridge, mergeToys, refreshToys, zeroAll]);

  // While the page is open: Bluetooth read every few seconds, so switching it
  // on shows without leaving the app, and every connected toy's battery asked
  // once a minute by the battery watch (the owner's ask, Oct 19 2026). Both are questions
  // and move nothing.
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    const statusTimer = setInterval(() => {
      LovenseToys.status().then((current) => { if (alive) setStatus(current); }).catch(() => {});
    }, 3000);
    const releaseBatteries = watchToyBatteries();
    return () => { alive = false; clearInterval(statusTimer); releaseBatteries(); };
  }, [bridge]);

  // ---- the owner's stop ----

  const stop = useCallback(() => {
    // The page goes still at once; the bridge holds the toys on its side.
    zeroAll();
    setHoldUntil(Date.now() + 3000);
    stopAllToys().catch((error) => setMessage(errorText(error)));
  }, [zeroAll]);

  // ---- setup ----

  const allow = useCallback(async () => {
    try {
      setStatus(await LovenseToys.requestAccess());
    } catch (error) {
      setMessage(errorText(error));
    }
  }, []);

  const find = useCallback(async () => {
    setMessage(null);
    try {
      // Asked fresh, so Bluetooth switched on since the page opened counts.
      let current = await LovenseToys.status();
      if (!current.permitted) current = await LovenseToys.requestAccess();
      setStatus(current);
      if (!current.permitted) {
        setMessage('Without the nearby devices permission the phone cannot look for toys.');
        return;
      }
      if (!current.bluetoothOn) {
        setMessage('Bluetooth is off. Turn it on and try again.');
        return;
      }
      setSearching(true);
      await LovenseToys.search();
      noteToySearchStarted();
    } catch (error) {
      setSearching(false);
      setMessage(errorText(error));
    }
  }, []);

  // A tap is ended by the tracker: connected, failed, an error for the toy, or
  // no answer at all (it reads the toy list once and says which). Connect
  // comes back after a few seconds either way, so the owner can tap again.
  const connect = useCallback((toy: LovenseToy) => {
    setMessage(null);
    startToyConnect(toy.toyId, {
      name: toyName(toy),
      scanning: searching,
      bluetoothOn: status?.bluetoothOn,
      tokenSet: status?.tokenSet,
      shownConnected: toy.connected,
    });
  }, [searching, status]);

  useEffect(() => onToyConnectEnded((end) => {
    void refreshToys();
    if (end.outcome === 'timeout') setMessage('That toy would not connect. Is it on and close by?');
    else if (end.outcome === 'refused' && end.detail) setMessage(end.detail);
  }), [refreshToys]);

  useEffect(() => {
    toyConnectPage(true);
    return () => toyConnectPage(false);
  }, []);

  const disconnect = useCallback(async (toyId: string) => {
    zeroAll(toyId);
    try {
      await LovenseToys.disconnect({ toyId });
      await refreshToys();
    } catch (error) {
      setMessage(errorText(error));
    }
  }, [refreshToys, zeroAll]);

  // ---- driving ----

  const send = useCallback((toyId: string, command: string, level: number) => {
    lastSent.current[`${toyId}:${command}`] = Date.now();
    LovenseToys.command({ toyId, command, level }).catch((error) => {
      if (!isHeld(error)) setMessage(errorText(error));
    });
  }, []);

  const setLevel = useCallback((toyId: string, command: string, level: number) => {
    const key = `${toyId}:${command}`;
    // The owner's hand on a motor takes it off whichever companion was driving it.
    yieldToOwner(toyId, command);
    setLevels((prev) => ({ ...prev, [key]: level }));
    clearTimeout(pending.current[key]);
    const wait = SEND_EVERY_MS - (Date.now() - (lastSent.current[key] ?? 0));
    if (wait <= 0) {
      send(toyId, command, level);
    } else {
      pending.current[key] = setTimeout(() => {
        delete pending.current[key];
        send(toyId, command, level);
      }, wait);
    }
  }, [send]);

  // Leaving the page puts down every motor the owner was holding up. The sliders
  // live only here, so a toy left at 15 used to keep running with no stop on
  // screen anywhere and read 0 when they came back (found in an outside
  // audit). A throttled send still waiting goes out as a zero too, so a slider
  // dragged to 0 just before leaving is not lost. What a lane is playing is
  // its own, and its own stop ends it.
  const levelsNow = useRef(levels);
  levelsNow.current = levels;
  useEffect(() => () => {
    const keys = new Set([...Object.keys(pending.current), ...Object.entries(levelsNow.current).filter(([, l]) => l > 0).map(([k]) => k)]);
    for (const key of keys) {
      clearTimeout(pending.current[key]);
      const cut = key.lastIndexOf(':');
      LovenseToys.command({ toyId: key.slice(0, cut), command: key.slice(cut + 1), level: 0 }).catch(() => {});
    }
  }, []);

  const plain = useCallback((toyId: string, command: string) => {
    LovenseToys.command({ toyId, command }).catch((error) => {
      if (!isHeld(error)) setMessage(errorText(error));
    });
  }, []);

  const list = Object.values(toys).sort((a, b) => Number(b.connected) - Number(a.connected) || toyName(a).localeCompare(toyName(b)));

  const toggleLook = useCallback(() => {
    setLook((prev) => {
      const next: WaveLook = prev === 'starlit' ? 'pure' : 'starlit';
      try {
        localStorage.setItem(LOOK_KEY, next);
      } catch {
        /* the pick just won't be remembered */
      }
      return next;
    });
  }, []);

  // The theme's accent, read off the page as a real color the canvas can use, and a
  // few relatives of it so two motors on one toy are told apart at a glance.
  const accentHex = useMemo(
    () => cssColorHex(getComputedStyle(document.documentElement).getPropertyValue('--aerie-accent'), '#f97316'),
    [colors.accent],
  );
  const palette = useMemo(
    () => [accentHex, mixHex(accentHex, '#ffffff', 0.55), mixHex(accentHex, '#ffd27a', 0.5), mixHex(accentHex, '#ffffff', 0.3)],
    [accentHex],
  );

  // The cards wear the theme's two colors, deepened toward the night sky so
  // white text and the glow both read on them, in Daylight as well, so the
  // gradients match the theme. The STOP above them
  // keeps the full-strength fill, so it is still the loudest thing here.
  const themeDeep = (pct: number, base = '#0b0a0f') => ({
    a: `color-mix(in srgb, var(--aerie-theme-a, var(--aerie-accent)) ${pct}%, ${base})`,
    b: `color-mix(in srgb, var(--aerie-theme-b, var(--aerie-accent)) ${pct}%, ${base})`,
  });
  const cardFill = `linear-gradient(120deg, ${themeDeep(48).a} 0%, ${themeDeep(40).b} 100%)`;
  const skyFill = `radial-gradient(120% 90% at 50% 0%, ${themeDeep(16, '#100d14').a} 0%, ${themeDeep(8, '#08070b').b} 72%)`;

  const connected = list.filter((toy) => toy.connected);
  // What a companion is driving from the house, motor by motor. It draws in
  // their color, and the sliders show it, until the owner's hand takes a
  // motor back.
  const driver = remote.playing ? ownerForCompanion(remote.playing.companion) : null;
  const remoteLevels = new Map((remote.playing?.motors ?? []).map((m) => [`${m.toyId}:${m.command}`, m.level]));
  const liveTracks: LiveTrack[] = [];
  for (const toy of connected) {
    motorsFor(toy).forEach((motor, i) => {
      const key = `${toy.toyId}:${motor.command}`;
      const driven = driver !== null && remoteLevels.has(key);
      const name = connected.length > 1 ? `${toyName(toy)} ${motor.label.toLowerCase()}` : motor.label;
      liveTracks.push({
        key,
        label: driven ? `${driver.name}: ${name.toLowerCase()}` : name,
        color: driven ? (i === 0 ? driver.color : mixHex(driver.color, '#ffffff', 0.45)) : palette[liveTracks.length % palette.length],
        level: holding ? 0 : driven ? remoteLevels.get(key) ?? 0 : levels[key] ?? 0,
        max: motor.max,
      });
    });
  }
  // The orbs go down this page's own list: the first finger down is the first
  // companion on the top toy, then on down the motors. With two toys on, each orb names
  // its toy, because two orbs both saying vibration cannot be told apart.
  const orbMotors: OrbMotor[] = connected.flatMap((toy) =>
    motorsFor(toy).map((motor) => ({
      toyId: toy.toyId,
      command: motor.command,
      label: connected.length > 1 ? `${toyName(toy).replace(/^lovense\s+/i, '')} ${motor.label.toLowerCase()}` : motor.label.toLowerCase(),
      max: motor.max,
    })),
  );
  // The orbs have no stop button (by design: letting go is the stop), so the
  // way in zeroes every motor and every toy's own pattern first. Then nothing
  // can be left running that a lifted finger would not stop. These are plain
  // zeros, not the owner's stop, so there is no hold to wait out.
  const openOrbs = useCallback(() => {
    for (const toy of connected) {
      for (const motor of motorsFor(toy)) setLevel(toy.toyId, motor.command, 0);
      if (toy.commands.includes('PRESET')) setLevel(toy.toyId, 'PRESET', 0);
    }
    setOrbsOpen(true);
  }, [connected, setLevel]);

  const waveTracks: LiveTrack[] = liveTracks.length > 0
    ? liveTracks
    : [{ key: 'idle', label: '', color: accentHex, level: 0, max: 20 }];
  const playing = connected
    .filter((toy) => (levels[`${toy.toyId}:PRESET`] ?? 0) > 0)
    .map((toy) => (connected.length > 1 ? `${toyName(toy)}: pattern ${levels[`${toy.toyId}:PRESET`]}` : `Pattern ${levels[`${toy.toyId}:PRESET`]} playing`));
  if (driver && remote.playing?.preset) playing.push(`${driver.name} is playing pattern ${remote.playing.preset}`);
  const closedLine =
    remote.closedBy === 'stop' ? 'Your stop took it back. Hand it over again whenever you like.'
    : remote.closedBy === 'red' ? 'You said red, so it stays yours until you hand it over.'
    : remote.closedBy === 'owner' ? 'You took it back. It is yours until you hand it over.'
    : 'Your companions can reach your toys from the house until you stop or take it back.';

  return (
    <AppShell title="Toys" icon={Waves} onClose={onClose} themeConfig={themeConfig} themeMode={themeMode}>
      <div className="flex flex-col gap-3 p-4 pb-24">
        {!bridge && (
          <div className={cn(panel, 'p-4 text-sm')}>
            <p className={colors.textMain}>This needs the new version of the app.</p>
            <p className={cn('mt-1 text-xs', colors.textMuted)}>
              The toys are reached from the phone itself, and the app on this phone was built before that part existed.
            </p>
          </div>
        )}

        {bridge && (
          <div
            className="relative overflow-hidden rounded-2xl border"
            style={{ background: skyFill, borderColor: `${accentHex}40` }}
          >
            <ToyWave tracks={waveTracks} look={look} />
            {liveTracks.length > 0 && (
              <div className="pointer-events-none absolute left-3 top-2.5 flex max-w-[65%] flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/75">
                {liveTracks.map((t) => (
                  <span key={t.key} className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: t.color, boxShadow: `0 0 6px ${t.color}` }} />
                    {t.label}
                  </span>
                ))}
              </div>
            )}
            <button
              onClick={toggleLook}
              className="absolute right-2.5 top-2 rounded-[var(--shape-control)] bg-white/10 px-2.5 py-1 text-[11px] text-white/85 backdrop-blur-sm transition-colors active:bg-white/20"
            >
              {look === 'starlit' ? 'Starlight' : 'Wave'}
            </button>
            {playing.length > 0 && (
              <div className="pointer-events-none absolute bottom-2 left-3 flex flex-wrap gap-1.5">
                {playing.map((label) => (
                  <span key={label} className="rounded-[var(--shape-control)] bg-white/10 px-2 py-0.5 text-[11px] text-white/80">{label}</span>
                ))}
              </div>
            )}
            {liveTracks.length === 0 && (
              <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[11px] text-white/45">
                Connect a toy and its line draws here
              </p>
            )}
          </div>
        )}

        {bridge && (
          <button
            onClick={openOrbs}
            className="relative flex w-full items-center justify-between overflow-hidden rounded-2xl border px-4 py-3.5 text-left transition-transform active:scale-[0.99]"
            style={{ background: cardFill, borderColor: `${accentHex}33` }}
          >
            <span className="flex flex-col">
              <span className="text-sm font-medium text-white">Orbs</span>
              <span className="text-xs text-white/60">Press and drag. Higher is stronger.</span>
            </span>
            <span className="flex items-center gap-1.5" aria-hidden>
              {['#ff6a1a', '#6aa8ff', '#b388ff'].map((c) => (
                <span key={c} className="inline-block h-3.5 w-3.5 rounded-full" style={{ background: c, boxShadow: `0 0 10px ${c}` }} />
              ))}
            </span>
          </button>
        )}

        {bridge && remote.gate === 'open' && (
          <div
            className="relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-2xl border px-4 py-3.5"
            style={{ background: cardFill, borderColor: `${driver?.color ?? accentHex}66` }}
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium" style={{ color: driver?.color ?? '#ffffff' }}>
                {driver ? `${driver.name} is playing` : 'Your companions have the remote'}
              </span>
              <span className="text-xs text-white/60">Taking it back stops every toy. Any stop or red takes it back too.</span>
            </span>
            <button
              onClick={takeBack}
              className="shrink-0 rounded-[var(--shape-control)] bg-white/10 px-3 py-1.5 text-xs text-white/90 transition-colors active:bg-white/20"
            >
              Take it back
            </button>
          </div>
        )}

        {bridge && remote.gate === 'closed' && (
          <button
            onClick={handOver}
            className="relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-2xl border px-4 py-3.5 text-left transition-transform active:scale-[0.99]"
            style={{ background: cardFill, borderColor: `${accentHex}33` }}
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium text-white">Hand over the remote</span>
              <span className="text-xs text-white/60">{closedLine}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1" aria-hidden>
              {['#ff6a1a', '#6aa8ff', '#b388ff'].map((c) => (
                <span key={c} className="inline-block h-2 w-5 rounded-full" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
              ))}
            </span>
          </button>
        )}

        {bridge && (
          <div className={cn(panel, 'flex flex-col gap-2 p-4 text-sm')}>
            <div className="flex items-center justify-between">
              <span className={cn('flex items-center gap-2', colors.textMain)}><Bluetooth size={15} /> Bluetooth</span>
              <span className={colors.textMuted}>{status ? (status.bluetoothOn ? 'On' : 'Off') : '…'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className={colors.textMain}>Nearby devices</span>
              {status?.permitted ? (
                <span className={colors.textMuted}>Allowed</span>
              ) : (
                <button onClick={allow} className="rounded-lg px-3 py-1 text-xs font-medium" style={{ background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' }}>
                  Allow
                </button>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className={colors.textMain}>Lovense token</span>
              <span className={colors.textMuted}>{status?.tokenSet ? 'Handed in' : tokenProblem ? 'Missing' : '…'}</span>
            </div>
            {tokenProblem && <p className={cn('text-xs', colors.textMuted)}>{tokenProblem}</p>}
            <button
              onClick={find}
              disabled={searching || !status?.tokenSet}
              className={cn('mt-1 flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition-opacity active:opacity-70 disabled:opacity-40', colors.panelBorder, colors.textMain)}
            >
              {searching ? <LoaderCircle size={14} className="animate-spin" /> : <Search size={14} />}
              {searching ? 'Looking for toys…' : 'Find my toys'}
            </button>
          </div>
        )}

        {message && (
          <div className={cn(panel, 'flex items-start justify-between gap-3 p-3 text-xs')}>
            <span className={colors.textMain}>{message}</span>
            <button onClick={() => setMessage(null)} className={colors.textMuted}>Dismiss</button>
          </div>
        )}

        {/* The owner stop sits small, right above the toys (theirs, Oct 23 2026: 'Small
            stop. Above the toys.'). Take it back stops everything too now, and
            their own controls are on this page, so it no longer needs to be the
            biggest thing on it; it is still the one tap that stops every toy
            at once and holds them still. */}
        {bridge && (
          <button
            onClick={stop}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold tracking-wide shadow transition-transform active:scale-[0.98]"
            style={{ background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' }}
            aria-label="Stop every toy"
          >
            <Hand size={16} /> STOP
            <span className="text-[11px] font-normal tracking-normal opacity-80">
              {holding
                ? 'Holding a moment'
                : remote.gate === 'open'
                  ? 'every toy, and the remote back'
                  : 'every toy'}
            </span>
          </button>
        )}

        {bridge && list.map((toy) => {
          const motors = toy.connected ? motorsFor(toy) : [];
          const presetCount = toy.connected ? presetsFor(toy) : 0;
          const light = toy.connected && toy.commands.includes('ALIGHT_ON');
          const battery = batteries[toy.toyId];
          const tapped = connects[toy.toyId];
          return (
            <div key={toy.toyId} className={cn(panel, 'flex flex-col gap-3 p-4')}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  {/* Tap the name to call the toy what the owner likes (theirs, Oct 19 2026: the
                      Fizz came through as its Bluetooth address). */}
                  {renaming === toy.toyId ? (
                    <input
                      autoFocus
                      defaultValue={toyName(toy)}
                      onBlur={(e) => { setToyName(toy.toyId, e.target.value); setRenaming(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }}
                      className={cn('w-full rounded-md border bg-transparent px-1.5 py-0.5 text-sm font-medium outline-none', colors.panelBorder, colors.textMain)}
                    />
                  ) : (
                    <button onClick={() => setRenaming(toy.toyId)} className={cn('max-w-full truncate text-left text-sm font-medium', colors.textMain)} title="Rename">{toyName(toy)}</button>
                  )}
                  <p className={cn('flex items-center gap-1 text-xs', colors.textMuted)}>
                    {toy.connected ? 'Connected' : 'Not connected'}
                    {toy.connected && battery && (
                      <><span>·</span>{batteryIcon(battery.level)} {battery.level}%</>
                    )}
                  </p>
                </div>
                {toy.connected ? (
                  <button onClick={() => disconnect(toy.toyId)} className={cn('rounded-lg border px-3 py-1.5 text-xs', colors.panelBorder, colors.textMuted)}>
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={() => connect(toy)}
                    disabled={!!tapped?.connecting && !tapped.canTapAgain}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                    style={{ background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' }}
                  >
                    {tapped?.connecting && <LoaderCircle size={12} className="animate-spin" />}
                    Connect
                  </button>
                )}
              </div>

              {/* The owner motors stand up side by side, bottom is off and up is more,
                  so a thumb runs each one like a fader (theirs, Oct 19 2026). */}
              {motors.length > 0 && (
                <div className="flex items-end justify-around gap-3">
                  {motors.map((motor) => {
                    const key = `${toy.toyId}:${motor.command}`;
                    const value = remoteLevels.get(key) ?? levels[key] ?? 0;
                    return (
                      <label key={key} className={cn('flex min-w-0 flex-1 flex-col items-center gap-1.5', holding && 'opacity-40')}>
                        <span className={cn('text-xs tabular-nums', colors.textMuted)}>{value} / {motor.max}</span>
                        <input
                          type="range"
                          min={0}
                          max={motor.max}
                          step={1}
                          value={value}
                          disabled={holding}
                          onChange={(e) => setLevel(toy.toyId, motor.command, Number(e.target.value))}
                          aria-label={motor.label}
                          className="h-40 w-8"
                          style={{ accentColor: colors.accent, writingMode: 'vertical-lr', direction: 'rtl' }}
                        />
                        <span className={cn('w-full truncate text-center text-xs', colors.textMuted)}>{motor.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              {presetCount > 0 && (
                <div className={cn('flex flex-col gap-1.5', holding && 'pointer-events-none opacity-40')}>
                  <span className={cn('text-xs', colors.textMuted)}>Its own patterns</span>
                  <div className="grid grid-cols-6 gap-1">
                    {Array.from({ length: presetCount }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        onClick={() => setLevel(toy.toyId, 'PRESET', n)}
                        className={cn('rounded-lg border py-1.5 text-xs', colors.panelBorder, colors.textMain)}
                        style={levels[`${toy.toyId}:PRESET`] === n ? { borderColor: colors.accent, color: colors.accent } : undefined}
                      >
                        {n}
                      </button>
                    ))}
                    <button
                      onClick={() => setLevel(toy.toyId, 'PRESET', 0)}
                      className={cn('rounded-lg border py-1.5 text-xs', colors.panelBorder, colors.textMuted)}
                    >
                      Off
                    </button>
                  </div>
                </div>
              )}

              {light && (
                <div className="flex items-center justify-between">
                  <span className={cn('flex items-center gap-1.5 text-xs', colors.textMuted)}><Lightbulb size={13} /> Its light</span>
                  <div className="flex gap-1">
                    <button onClick={() => plain(toy.toyId, 'ALIGHT_ON')} className={cn('rounded-lg border px-3 py-1 text-xs', colors.panelBorder, colors.textMain)}>On</button>
                    <button onClick={() => plain(toy.toyId, 'ALIGHT_OFF')} className={cn('rounded-lg border px-3 py-1 text-xs', colors.panelBorder, colors.textMain)}>Off</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {bridge && status && list.length === 0 && !searching && (
          <p className={cn('px-1 text-center text-xs', colors.textMuted)}>
            Turn a toy on, then tap Find my toys.
          </p>
        )}
      </div>
      {orbsOpen && bridge && (
        <ToyOrbs motors={orbMotors} holding={holding} onLevel={setLevel} onClose={() => setOrbsOpen(false)} />
      )}
    </AppShell>
  );
}
