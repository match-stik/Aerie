// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Lovense: this file drives Lovense toys. Running Aerie needs your own Lovense
// developer account and token; carrying this code into another project needs
// that project's own agreement and approval from Lovense. See
// packages/phone/android/LOVENSE.md.
// Toys: their person's Lovense toys over Bluetooth from this phone, through the
// LovenseToys bridge (aerie/lovense-toys.ts) and Lovense's own SDK, with no
// Lovense Remote and no cloud in between.
//
// The stop is the first thing on the page and the biggest, and it is never
// disabled: whatever else is loading, waiting or broken, it can be pressed.
// While its hold runs the sliders are shut too, so nothing on this page looks
// like it is driving a toy when it is not.
//
// Their person can hand the companions the remote from here (aerie/toy-remote.ts).
// While a companion is playing, the line and the sliders show what they are
// doing in their color, any slider their person moves takes that motor back, and
// the stop takes it all back.

import { rememberToyName, setToyName, toyName } from '../lib/toy-names';
import { PRESETS_MAX, toySettings } from '../lib/toy-settings';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, Bluetooth, Hand, Lightbulb, LoaderCircle, Search, Settings2, Trash2, Waves } from 'lucide-react';
import { AppShell } from './AppShell';
import { ToyWave, cssColorHex, mixHex, type LiveTrack } from './ToyWave';
import { ToyOrbs, type OrbMotor } from './ToyOrbs';
import { ToySlidePad, type SlideMotor } from './ToySlidePad';
import { ToySoundShelf } from './ToySoundShelf';
import { SoundBarInline } from './SoundBar';
import { useSoundDriveLevels } from '../aerie/sound-drive';
import { ToyPatternShelf, type LevelTap } from './ToyPatternShelf';
import type { WaveLook } from '../lib/pattern-wave';
import { ownerForCompanion } from '../lib/orb-field';
import { handOver, setHands, takeBack, useToyBatteries, useToyRemote, watchToyBatteries, yieldToOwner } from '../aerie/toy-remote';
import { cancelToyConnect, noteToySearchStarted, onToyConnectEnded, startToyConnect, toyConnectPage, toyConnecting, useToyConnects } from '../aerie/toy-connect';
import { connectionState } from '../lib/toy-connect';
import type { ThemeConfig } from '../lib/theme';
import { cn } from '../lib/utils';
import { lendDriver, noteOwnPreset, ownDrives, useOwnPlay, watchOwnStops } from '../aerie/own-play';
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

/** Where their person's pick of the line's look is kept between visits. */
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

type ToysTab = 'remote' | 'patterns' | 'sounds' | 'toys';
const TABS: { id: ToysTab; label: string }[] = [
  { id: 'remote', label: 'Remote' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'sounds', label: 'Sounds' },
  { id: 'toys', label: 'Toys' },
];
const TAB_KEY = 'aerie.toys-tab';

/** A pad with two motors and no toy behind it, so a pattern can be made on the
 *  Patterns tab with nothing connected (theirs, Nov 10 2026). A pattern keeps its
 *  tracks as motor1 and motor2, so what is made here plays on any toy later.
 *  Nothing on this id ever reaches the toy bridge. */
const PRACTICE_TOY: LovenseToy = { toyId: 'practice', name: 'Practice pad', connected: true, commands: ['VIBRATE1', 'VIBRATE2'] };
const PAD_KEY = 'aerie.toys-pad';

export function ToysApp({ onClose, themeConfig, themeMode }: ToysAppProps) {
  const colors = themeConfig[themeMode];
  const panel = cn('rounded-[var(--shape-surface)] border', colors.panelBg, colors.panelBorder);
  const onAccent = 'var(--aerie-on-accent)';
  const bridge = hasToyBridge();
  const remote = useToyRemote();
  // Each toy's own battery answer, never the SDK's field (aerie/toy-remote.ts).
  const batteries = useToyBatteries();

  const [status, setStatus] = useState<ToysStatus | null>(null);
  const [toys, setToys] = useState<Record<string, LovenseToy>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  // Which toy's settings are open under its card (theirs, Nov 10 2026).
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  // The page is four tabs, so it is not one long scroll (theirs, Nov 10 2026,
  // after Lovense's remote): Remote to play, Patterns, Sounds, and Toys to
  // set up. Their hand-over and their stop sit above the tabs on every one.
  const [tab, setTab] = useState<ToysTab>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      return saved === 'patterns' || saved === 'sounds' || saved === 'toys' ? saved : 'remote';
    } catch {
      return 'remote';
    }
  });
  // Remote plays as a slide pad, a bubble per motor, or as plain sliders,
  // like Lovense's Slide and Traditional (theirs, Nov 10 2026).
  const [pad, setPad] = useState<'slide' | 'sliders'>(() => {
    try {
      return localStorage.getItem(PAD_KEY) === 'sliders' ? 'sliders' : 'slide';
    } catch {
      return 'slide';
    }
  });
  const pickPad = useCallback((next: 'slide' | 'sliders') => {
    setPad(next);
    try { localStorage.setItem(PAD_KEY, next); } catch { /* still picked */ }
  }, []);
  const pickTab = useCallback((next: ToysTab) => {
    setTab(next);
    try { localStorage.setItem(TAB_KEY, next); } catch { /* the tab is still picked */ }
  }, []);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  useSyncExternalStore(toySettings.subscribe, toySettings.version, toySettings.version);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [searching, setSearching] = useState(false);
  // Each tap on Connect, followed to its end by the tracker (aerie/toy-connect.ts).
  const connects = useToyConnects();
  const [tokenProblem, setTokenProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [holdUntil, setHoldUntil] = useState(0);
  const [, setTick] = useState(0);
  const [orbsOpen, setOrbsOpen] = useState(false);
  const [stopEpoch, setStopEpoch] = useState(0);
  // Back closes the Orbs screen and leaves their person on the Toys page.
  useBackHandler(orbsOpen, () => setOrbsOpen(false));
  const [look, setLook] = useState<WaveLook>(() => {
    try {
      return localStorage.getItem(LOOK_KEY) === 'pure' ? 'pure' : 'starlit';
    } catch {
      return 'starlit';
    }
  });

  // While the orbs are open their person's fingers drive, and no lane can.
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
        // A toy they deleted stays off the list until a search finds it again.
        if (toySettings.forgotten(toy.toyId)) continue;
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
      LovenseToys.addListener('toyFound', (toy) => {
        toySettings.remember(toy.toyId);
        mergeToys([toy]);
      }),
      LovenseToys.addListener('searchFinished', () => setSearching(false)),
      LovenseToys.addListener('connection', (c) => {
        // While their tap is still waiting, a failed callback is not the answer:
        // the SDK often tries again by itself a second later and connects, and
        // the tracker waits for that (their Nov 9 2026 log). The message comes
        // when the tracker ends the tap; here it is only for a toy that drops.
        if (connectionState(c.state) === 'failed') {
          if (!toyConnecting(c.toyId)) setMessage('That toy would not connect. Is it on and close by?');
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
        setStopEpoch((n) => n + 1);
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
  // once a minute by the battery watch (their person's ask, Oct 19 2026). Both are questions
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

  // ---- their person's stop ----

  const stop = useCallback(() => {
    // The page goes still at once; the bridge holds the toys on its side.
    zeroAll();
    setStopEpoch((n) => n + 1);
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
  // comes back after a few seconds either way, so their person can tap again.
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
    if (end.outcome === 'cancelled') setMessage(null);
    else if (end.outcome === 'timeout' || end.outcome === 'failed' || end.outcome === 'error') setMessage('That toy would not connect. Is it on and close by?');
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

  // Delete takes a toy off their list: disconnected first, then forgotten until
  // a search finds it again. The toy and Lovense's app keep their own record.
  const deleteToy = useCallback(async (toyId: string) => {
    zeroAll(toyId);
    try {
      await LovenseToys.disconnect({ toyId });
    } catch {
      // Already gone is fine; it still comes off the list.
    }
    toySettings.forget(toyId);
    setToys((prev) => {
      const next = { ...prev };
      delete next[toyId];
      return next;
    });
    setSettingsFor(null);
    setConfirmDelete(null);
  }, [zeroAll]);

  // ---- driving ----

  const send = useCallback((toyId: string, command: string, level: number) => {
    lastSent.current[`${toyId}:${command}`] = Date.now();
    if (toyId === PRACTICE_TOY.toyId) return;
    LovenseToys.command({ toyId, command, level }).catch((error) => {
      if (!isHeld(error)) setMessage(errorText(error));
    });
  }, []);

  // driveLevel is the road every level takes; setLevel is their person's own hand on it,
  // which the pattern shelf hears (to take over from a playing pattern, and to
  // write a recording down). The shelf plays through driveLevel.
  const patternTap = useRef<LevelTap | null>(null);
  const driveLevel = useCallback((toyId: string, command: string, level: number) => {
    const key = `${toyId}:${command}`;
    // Their person's hand on a motor takes it off whichever companion was driving it.
    if (toyId !== PRACTICE_TOY.toyId) yieldToOwner(toyId, command);
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

  const setLevel = useCallback((toyId: string, command: string, level: number) => {
    patternTap.current?.(toyId, command, level);
    driveLevel(toyId, command, level);
  }, [driveLevel]);

  // What they start keeps playing off this page (aerie/own-play.ts); while the
  // page is open it plays through this page's road, so the wave draws it.
  useEffect(() => lendDriver(driveLevel), [driveLevel]);
  useEffect(() => { watchOwnStops(); }, []);
  const own = useOwnPlay();
  const ownPreset = own.playing?.kind === 'preset' ? own.playing : null;
  const presetLevel = (toyId: string): number =>
    levels[`${toyId}:PRESET`] || (ownPreset && ownPreset.toyId === toyId ? ownPreset.preset ?? 0 : 0);

  // Leaving the page puts down every motor their person was holding up. The sliders
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
      // What they started from the shelf or a stored pattern keeps playing
      // after they leave; their stop follows them around the app (theirs, Nov 10 2026).
      if (ownDrives(key)) continue;
      clearTimeout(pending.current[key]);
      if (key.startsWith(`${PRACTICE_TOY.toyId}:`)) continue;
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
  // What a playing sound is giving each motor, so the wave draws it too.
  const soundLevels = useSoundDriveLevels();
  // What a companion is driving from the house, motor by motor. It draws in
  // their color, and the sliders show it, until their person's hand takes a
  // motor back.
  const driver = remote.playing ? ownerForCompanion(remote.playing.companion) : null;
  const remoteLevels = new Map((remote.playing?.motors ?? []).map((m) => [`${m.toyId}:${m.command}`, m.level]));
  // With no toy on, the Patterns tab draws and records on the practice pad.
  const practicing = tab === 'patterns' && connected.length === 0;
  const padToys = practicing ? [PRACTICE_TOY] : connected;
  const liveTracks: LiveTrack[] = [];
  for (const toy of padToys) {
    motorsFor(toy).forEach((motor, i) => {
      const key = `${toy.toyId}:${motor.command}`;
      const driven = driver !== null && remoteLevels.has(key);
      const name = padToys.length > 1 ? `${toyName(toy)} ${motor.label.toLowerCase()}` : motor.label;
      liveTracks.push({
        key,
        label: driven ? `${driver.name}: ${name.toLowerCase()}` : name,
        color: driven ? (i === 0 ? driver.color : mixHex(driver.color, '#ffffff', 0.45)) : palette[liveTracks.length % palette.length],
        level: holding ? 0 : driven ? remoteLevels.get(key) ?? 0 : soundLevels[key] ?? levels[key] ?? 0,
        max: motor.max,
      });
    });
  }
  const slideMotors: SlideMotor[] = padToys.flatMap((toy) =>
    motorsFor(toy).map((motor) => {
      const key = `${toy.toyId}:${motor.command}`;
      const track = liveTracks.find((t) => t.key === key);
      return {
        key,
        toyId: toy.toyId,
        command: motor.command,
        label: connected.length > 1 ? `${toyName(toy).replace(/^lovense\s+/i, '')} ${motor.label.toLowerCase()}` : motor.label,
        max: motor.max,
        color: track?.color ?? accentHex,
        level: holding ? 0 : remoteLevels.get(key) ?? levels[key] ?? 0,
      };
    }),
  );
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
  // zeros, not their person's stop, so there is no hold to wait out.
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
    .filter((toy) => presetLevel(toy.toyId) > 0)
    .map((toy) => (connected.length > 1 ? `${toyName(toy)}: pattern ${presetLevel(toy.toyId)}` : `Pattern ${presetLevel(toy.toyId)} playing`));
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

        {bridge && remote.gate === 'open' && (
          <div
            className="relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-[var(--shape-surface)] border px-4 py-3.5"
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
            className="relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-[var(--shape-surface)] border px-4 py-3.5 text-left transition-transform active:scale-[0.99]"
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

        {/* Their stop sits small, right above the toys (theirs, Oct 23 2026: 'Small
            stop. Above the toys.'). Take it back stops everything too now, and
            their own controls are on this page, so it no longer needs to be the
            biggest thing on it; it is still the one tap that stops every toy
            at once and holds them still. */}
        {bridge && (
          <button
            onClick={stop}
            className="flex w-full items-center justify-center gap-2 rounded-[var(--shape-control)] py-2.5 text-sm font-bold tracking-wide shadow transition-transform active:scale-[0.98]"
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

        {bridge && (
          <div className={cn('grid grid-cols-4 gap-1 rounded-[var(--shape-control)] border p-1', colors.panelBg, colors.panelBorder)} role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => pickTab(t.id)}
                className={cn('rounded-[var(--shape-chip)] py-1.5 text-xs font-medium transition-colors', tab === t.id ? '' : colors.textMuted)}
                style={tab === t.id ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' } : undefined}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* The live wave shows on Patterns too, so what their fingers are
            recording draws as they make it (theirs, Nov 10 2026). */}
        {bridge && (tab === 'remote' || tab === 'patterns') && (
          <div
            className="relative overflow-hidden rounded-[var(--shape-surface)] border"
            style={{ background: skyFill, borderColor: `${accentHex}40` }}
          >
            <ToyWave tracks={waveTracks} look={look} />
            {/* A toy's own stored pattern plays inside the toy and never tells
                the phone its levels, so there is no line to draw; a soft
                shimmer along the floor shows something is going instead of a
                flat line (theirs, Nov 10 2026). Decoration, not a reading. */}
            {playing.length > 0 && (
              <div
                className="aerie-preset-shimmer pointer-events-none absolute inset-x-0"
                style={{ bottom: '6%', height: '26%', ['--shimmer-color' as string]: accentHex }}
                aria-hidden
              />
            )}
            {liveTracks.length > 0 && playing.length === 0 && (
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
            {/* A stored pattern's name sits where the legend goes, at the top,
                because the line lies along the bottom while the toy plays
                its own (theirs, Nov 10 2026: the line ran through the label). */}
            {playing.length > 0 && (
              <div className="pointer-events-none absolute left-3 top-2.5 flex max-w-[65%] flex-wrap gap-1.5">
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

        {bridge && tab === 'remote' && (
          <button
            onClick={openOrbs}
            className="relative flex w-full items-center justify-between overflow-hidden rounded-[var(--shape-surface)] border px-4 py-3.5 text-left transition-transform active:scale-[0.99]"
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

        {bridge && tab === 'remote' && connected.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className={cn('grid grid-cols-2 gap-1 self-center rounded-[var(--shape-control)] border p-1 text-xs', colors.panelBg, colors.panelBorder)}>
              {(['slide', 'sliders'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => pickPad(p)}
                  className={cn('rounded-[var(--shape-chip)] px-4 py-1', pad === p ? '' : colors.textMuted)}
                  style={pad === p ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' } : undefined}
                >
                  {p === 'slide' ? 'Bubbles' : 'Faders'}
                </button>
              ))}
            </div>
            {pad === 'slide' && (
              <ToySlidePad motors={slideMotors} holding={holding} onLevel={setLevel} textMuted={colors.textMuted} panelClass={cn(colors.panelBg, colors.panelBorder)} />
            )}
          </div>
        )}

        {/* Kept mounted on every tab and only hidden, so a recording started
            here keeps listening while their hand moves on the Remote tab. */}
        {bridge && (
          <div className={tab === 'patterns' ? 'contents' : 'hidden'}>
          <ToyPatternShelf
            connected={padToys}
            levels={levels}
            tapRef={patternTap}
            stopEpoch={stopEpoch}
            lanePlaying={!!remote.playing}
            holding={holding}
            accentHex={accentHex}
            panelClass={panel}
            textMain={colors.textMain}
            textMuted={colors.textMuted}
            panelBorder={colors.panelBorder}
          />
          </div>
        )}

        {/* The Patterns tab carries its own pad, so a recording can be made
            without leaving it (theirs, Nov 10 2026). */}
        {bridge && tab === 'patterns' && padToys.length > 0 && (
          <ToySlidePad
            motors={slideMotors}
            holding={holding}
            onLevel={setLevel}
            textMuted={colors.textMuted}
            panelClass={cn(colors.panelBg, colors.panelBorder)}
            note={practicing ? 'No toy is on, so this is a practice pad. Record here and the pattern plays on any toy later.' : undefined}
          />
        )}

        {/* On every other tab, what the sound shelf is playing sits as a slim bar. */}
        {bridge && tab !== 'sounds' && <SoundBarInline />}

        {/* Their sounds play with or without a toy, so the shelf does not wait on the bridge. */}
        {(!bridge || tab === 'sounds') && (
          <ToySoundShelf
            accentHex={accentHex}
            panelClass={panel}
            textMain={colors.textMain}
            textMuted={colors.textMuted}
            panelBorder={colors.panelBorder}
          />
        )}

        {bridge && tab === 'toys' && (
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
                <button onClick={allow} className="rounded-[var(--shape-chip)] px-3 py-1 text-xs font-medium" style={{ background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' }}>
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
              className={cn('mt-1 flex w-full items-center justify-center gap-2 rounded-[var(--shape-control)] border py-3 text-sm font-medium transition-opacity active:opacity-70 disabled:opacity-40', colors.panelBorder, colors.textMain)}
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

        {bridge && tab === 'remote' && connected.length === 0 && (
          <button onClick={() => pickTab('toys')} className={cn(panel, 'p-4 text-center text-xs', colors.textMuted)}>
            No toy is connected yet. Connect one on the Toys tab.
          </button>
        )}

        {bridge && (tab === 'toys' || tab === 'remote') && list.filter((toy) => tab === 'toys' || (toy.connected && (pad === 'sliders' || presetsFor(toy) > 0 || toy.commands.includes('ALIGHT_ON')))).map((toy) => {
          const motors = toy.connected ? motorsFor(toy) : [];
          const presetCount = toy.connected ? presetsFor(toy) : 0;
          const light = toy.connected && toy.commands.includes('ALIGHT_ON');
          const battery = batteries[toy.toyId];
          const tapped = connects[toy.toyId];
          return (
            <div key={toy.toyId} className={cn(panel, 'flex flex-col gap-3 p-4')}>
              {tab === 'remote' && (
                <p className={cn('flex items-center gap-1 text-xs', colors.textMuted)}>
                  <span className={cn('font-medium', colors.textMain)}>{toyName(toy)}</span>
                  {battery && <><span>·</span>{batteryIcon(battery.level)} {battery.level}%</>}
                </p>
              )}
              {tab === 'toys' && (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  {/* Tap the name to call the toy what their person likes (theirs, Oct 19 2026: the
                      Fizz came through as its Bluetooth address). */}
                  {renaming === toy.toyId ? (
                    <input
                      autoFocus
                      defaultValue={toyName(toy)}
                      onBlur={(e) => { setToyName(toy.toyId, e.target.value); setRenaming(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }}
                      className={cn('w-full rounded-[var(--shape-chip)] border bg-transparent px-1.5 py-0.5 text-sm font-medium outline-none', colors.panelBorder, colors.textMain)}
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
                <div className="flex shrink-0 items-center gap-1.5">
                <button
                  onClick={() => { setSettingsFor((open) => (open === toy.toyId ? null : toy.toyId)); setConfirmDelete(null); }}
                  className={cn('rounded-[var(--shape-chip)] border p-1.5', colors.panelBorder, colors.textMuted)}
                  style={settingsFor === toy.toyId ? { borderColor: colors.accent, color: colors.accent } : undefined}
                  aria-label={`Settings for ${toyName(toy)}`}
                  aria-expanded={settingsFor === toy.toyId}
                >
                  <Settings2 size={14} />
                </button>
                {toy.connected ? (
                  <button onClick={() => disconnect(toy.toyId)} className={cn('rounded-[var(--shape-chip)] border px-3 py-1.5 text-xs', colors.panelBorder, colors.textMuted)}>
                    Disconnect
                  </button>
                ) : (
                  // While a tap waits, the button stops it rather than starting another
                  // (theirs, Nov 9 2026: the spinners kept going until they closed the app).
                  <button
                    onClick={() => (tapped?.connecting ? cancelToyConnect(toy.toyId) : connect(toy))}
                    className="flex items-center gap-1.5 rounded-[var(--shape-chip)] px-3 py-1.5 text-xs font-medium"
                    style={{ background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' }}
                    aria-label={tapped?.connecting ? `Stop connecting ${toyName(toy)}` : `Connect ${toyName(toy)}`}
                  >
                    {tapped?.connecting && <LoaderCircle size={12} className="animate-spin" />}
                    {tapped?.connecting ? 'Connecting… tap to stop' : 'Connect'}
                  </button>
                )}
                </div>
              </div>
              )}

              {tab === 'toys' && settingsFor === toy.toyId && (
                <ToySettingsPanel
                  toy={toy}
                  colors={colors}
                  confirming={confirmDelete === toy.toyId}
                  onAskDelete={() => setConfirmDelete(toy.toyId)}
                  onCancelDelete={() => setConfirmDelete(null)}
                  onDelete={() => void deleteToy(toy.toyId)}
                  onLight={(command) => plain(toy.toyId, command)}
                />
              )}

              {/* Their person motors stand up side by side, bottom is off and up is more,
                  so a thumb runs each one like a fader (theirs, Oct 19 2026). */}
              {tab === 'remote' && pad === 'sliders' && motors.length > 0 && (
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

              {tab === 'remote' && presetCount > 0 && (
                <div className={cn('flex flex-col gap-1.5', holding && 'pointer-events-none opacity-40')}>
                  <span className={cn('text-xs', colors.textMuted)}>Its own patterns</span>
                  <div className="grid grid-cols-6 gap-1">
                    {Array.from({ length: presetCount }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        onClick={() => { setLevel(toy.toyId, 'PRESET', n); noteOwnPreset(toy.toyId, toyName(toy), n); }}
                        className={cn('rounded-[var(--shape-chip)] border py-1.5 text-xs', colors.panelBorder, colors.textMain)}
                        style={presetLevel(toy.toyId) === n ? { borderColor: colors.accent, color: colors.accent } : undefined}
                      >
                        {n}
                      </button>
                    ))}
                    <button
                      onClick={() => { setLevel(toy.toyId, 'PRESET', 0); noteOwnPreset(toy.toyId, toyName(toy), 0); }}
                      className={cn('rounded-[var(--shape-chip)] border py-1.5 text-xs', colors.panelBorder, colors.textMuted)}
                    >
                      Off
                    </button>
                  </div>
                </div>
              )}

              {tab === 'remote' && light && (
                <div className="flex items-center justify-between">
                  <span className={cn('flex items-center gap-1.5 text-xs', colors.textMuted)}><Lightbulb size={13} /> Its light</span>
                  <div className="flex gap-1">
                    <button onClick={() => plain(toy.toyId, 'ALIGHT_ON')} className={cn('rounded-[var(--shape-chip)] border px-3 py-1 text-xs', colors.panelBorder, colors.textMain)}>On</button>
                    <button onClick={() => plain(toy.toyId, 'ALIGHT_OFF')} className={cn('rounded-[var(--shape-chip)] border px-3 py-1 text-xs', colors.panelBorder, colors.textMain)}>Off</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {bridge && tab === 'toys' && status && list.length === 0 && !searching && (
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

/** One toy's settings, under its card: strength per motor, how many of its
 *  own patterns it keeps, its light, and Delete (theirs, Nov 10 2026, after
 *  Lovense's own per-toy pages). Its name is changed by tapping the name. */
function ToySettingsPanel({ toy, colors, confirming, onAskDelete, onCancelDelete, onDelete, onLight }: {
  toy: LovenseToy;
  colors: ThemeConfig['dark'];
  confirming: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onLight: (command: string) => void;
}) {
  const settings = toySettings.get(toy.toyId);
  const motors = toy.commands.length ? motorsFor(toy) : [];
  const keepsPatterns = toy.commands.includes('PRESET');
  const presets = presetsFor(toy);
  const hasLight = toy.commands.includes('LIGHT_ON');
  const hasAlight = toy.commands.includes('ALIGHT_ON');
  const box = cn('flex flex-col gap-2 rounded-[var(--shape-control)] border p-3', colors.panelBorder);
  return (
    <div className="flex flex-col gap-2.5">
      {motors.length > 0 && (
        <div className={box}>
          <span className={cn('text-xs font-medium', colors.textMain)}>Strength</span>
          <span className={cn('text-[11px] leading-snug', colors.textMuted)}>
            How strong each motor is allowed to go. Everything is scaled to it: your hand, the patterns and ours.
          </span>
          {motors.map((motor) => {
            const value = settings.strength?.[motor.command] ?? 20;
            return (
              <label key={motor.command} className="flex flex-col gap-1">
                <span className={cn('flex justify-between text-xs', colors.textMuted)}>
                  <span>{motor.label}</span>
                  <span className="tabular-nums">{Math.round((value / 20) * 100)}%</span>
                </span>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={value}
                  onChange={(e) => toySettings.setStrength(toy.toyId, motor.command, Number(e.target.value))}
                  aria-label={`${motor.label} strength`}
                  style={{ accentColor: colors.accent }}
                />
              </label>
            );
          })}
        </div>
      )}
      {keepsPatterns && (
        <div className={cn(box, 'flex-row items-center justify-between')}>
          <span className="flex flex-col">
            <span className={cn('text-xs font-medium', colors.textMain)}>Its own patterns</span>
            <span className={cn('text-[11px] leading-snug', colors.textMuted)}>More if you programmed them in Lovense's app.</span>
          </span>
          <span className="flex items-center gap-1.5">
            <button onClick={() => toySettings.setPresets(toy.toyId, Math.max(1, presets - 1))} className={cn('h-7 w-7 rounded-[var(--shape-chip)] border text-sm', colors.panelBorder, colors.textMain)} aria-label="Fewer">−</button>
            <span className={cn('w-5 text-center text-sm tabular-nums', colors.textMain)}>{presets}</span>
            <button onClick={() => toySettings.setPresets(toy.toyId, Math.min(PRESETS_MAX, presets + 1))} className={cn('h-7 w-7 rounded-[var(--shape-chip)] border text-sm', colors.panelBorder, colors.textMain)} aria-label="More">+</button>
          </span>
        </div>
      )}
      {(hasLight || hasAlight) && toy.connected && (
        <div className={cn(box, 'flex-row items-center justify-between')}>
          <span className={cn('flex items-center gap-1.5 text-xs font-medium', colors.textMain)}><Lightbulb size={13} /> Its light</span>
          <span className="flex gap-1">
            <button onClick={() => onLight(hasAlight ? 'ALIGHT_ON' : 'LIGHT_ON')} className={cn('rounded-[var(--shape-chip)] border px-3 py-1 text-xs', colors.panelBorder, colors.textMain)}>On</button>
            <button onClick={() => onLight(hasAlight ? 'ALIGHT_OFF' : 'LIGHT_OFF')} className={cn('rounded-[var(--shape-chip)] border px-3 py-1 text-xs', colors.panelBorder, colors.textMain)}>Off</button>
          </span>
        </div>
      )}
      {confirming ? (
        <div className={cn(box, 'flex-row items-center justify-between')}>
          <span className={cn('text-xs', colors.textMain)}>Take {toyName(toy)} off the list?</span>
          <span className="flex gap-1">
            <button onClick={onCancelDelete} className={cn('rounded-[var(--shape-chip)] border px-3 py-1 text-xs', colors.panelBorder, colors.textMuted)}>Keep</button>
            <button onClick={onDelete} className="rounded-[var(--shape-chip)] px-3 py-1 text-xs font-medium text-white" style={{ background: '#c0392b' }}>Delete</button>
          </span>
        </div>
      ) : (
        <button onClick={onAskDelete} className={cn('flex items-center justify-center gap-1.5 rounded-[var(--shape-control)] border py-2 text-xs', colors.panelBorder)} style={{ color: '#e05a4f' }}>
          <Trash2 size={13} /> Delete toy
        </button>
      )}
      <span className={cn('px-1 text-[11px] leading-snug', colors.textMuted)}>
        A deleted toy comes back the next time Find my toys sees it.
      </span>
    </div>
  );
}
