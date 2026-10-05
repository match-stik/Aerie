// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BatteryCharging, Brush, Gamepad2, Heart, Moon, PawPrint, RotateCcw, Sparkles, X } from 'lucide-react';
import { AppShell } from './AppShell';
import type { ThemeConfig } from '../lib/theme';
import { cn, haptic } from '../lib/utils';
import { apiFetch } from '../aerie';

interface PetAppProps {
  onClose: () => void;
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
}

type PetAction = 'feed' | 'play' | 'nap' | 'pet';

interface PetState {
  name: string;
  hunger: number;
  joy: number;
  energy: number;
  bond: number;
  /** Derived server-side and sent with the row; see getMood below. */
  mood?: Mood;
  visits: number;
  createdAt: number;
  updatedAt: number;
}

interface PetEvent {
  id: number;
  actor: string;
  action: string;
  created_at: string;
}

const PET_ACCENT = '#ff7900';

// Who acted on the pet: a companion, or the owner. Companion emblems come from
// the companion records themselves rather than a list baked in here, so a house
// with different companions gets its own faces on the ledger.
const OWNER_SIGIL = '🧡';
const EVENT_VERBS: Record<string, string> = { feed: 'charged him', play: 'stirred chaos', nap: 'rebooted him', pet: 'booped him' };

function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
const ACTION_HOLD_MS: Record<PetAction, number> = {
  feed: 2200,
  play: 2400,
  nap: 3200,
  pet: 3000,
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function freshPet(): PetState {
  const now = Date.now();
  return {
    name: 'Pet',
    hunger: 76,
    joy: 82,
    energy: 68,
    bond: 12,
    visits: 1,
    createdAt: now,
    updatedAt: now,
  };
}

// He lives on the house server now, so the whole constellation can reach him.
interface ServerPet {
  name: string;
  hunger: number;
  joy: number;
  energy: number;
  bond: number;
  visits: number;
  created_at: string;
  updated_at: string;
}

function petFromServer(p: ServerPet): PetState {
  return {
    name: p.name,
    hunger: p.hunger,
    joy: p.joy,
    energy: p.energy,
    bond: p.bond,
    visits: p.visits,
    createdAt: new Date(p.created_at).getTime(),
    updatedAt: new Date(p.updated_at).getTime(),
  };
}

async function petApi(path: string, body?: Record<string, unknown>): Promise<{ pet?: ServerPet; events?: PetEvent[] } | null> {
  try {
    const res = await fetch(`/api/pet${path}`, {
      method: path === '' ? 'GET' : 'POST',
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function Creature({ mood, action, zooming }: { mood: Mood; action: PetAction | null; zooming: boolean }) {
  // Drawn rather than shipped. Whoever runs this should give their familiar a
  // face of its own — swap this component for artwork and it will behave the
  // same. Until then it is a placeholder that at least reacts.
  const eyes = action === 'nap' || mood === 'sleepy'
    ? 'closed'
    : mood === 'lowPower'
      ? 'dim'
      : mood === 'lonely'
        ? 'down'
        : 'open';

  const motionState = action === 'play' || (mood === 'radiant' && zooming)
    ? { rotate: [0, -6, 6, -4, 0], scale: [1, 1.05, .97, 1.04, 1] }
    : action === 'pet'
      ? { scale: [1, 1.07, .98, 1.04, 1] }
      : action === 'feed'
        ? { y: [0, -5, 0, -2, 0] }
        : { y: [0, -3, 0] };

  return (
    <motion.div
      className="h-full w-full flex items-center justify-center select-none"
      initial={false}
      animate={motionState}
      transition={{ duration: action ? .62 : 2.8, repeat: action ? 0 : Infinity, ease: 'easeInOut' }}
      role="img"
      aria-label={`${mood} familiar`}
    >
      <svg viewBox="0 0 120 120" className="h-full w-full" style={{ filter: 'drop-shadow(0 14px 18px rgba(0,0,0,.35))' }}>
        <g fill="none" stroke={PET_ACCENT} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          {/* ears */}
          <path d="M38 34 L34 16 L52 26" />
          <path d="M82 34 L86 16 L68 26" />
          {/* head */}
          <rect x="30" y="30" width="60" height="52" rx="18" />
          {/* body */}
          <path d="M40 82 q20 18 40 0" />
          {/* eyes */}
          {eyes === 'closed' && <><path d="M45 56 q6 5 12 0" /><path d="M63 56 q6 5 12 0" /></>}
          {eyes === 'open' && <><circle cx="51" cy="55" r="5" /><circle cx="69" cy="55" r="5" /></>}
          {eyes === 'dim' && <><circle cx="51" cy="55" r="5" opacity=".35" /><circle cx="69" cy="55" r="5" opacity=".35" /></>}
          {eyes === 'down' && <><path d="M45 58 q6 -5 12 0" /><path d="M63 58 q6 -5 12 0" /></>}
          {/* nose + whiskers */}
          <path d="M57 67 q3 4 6 0" />
          <path d="M30 62 L18 60 M30 68 L18 70 M90 62 L102 60 M90 68 L102 70" opacity=".5" />
        </g>
      </svg>
    </motion.div>
  );
}
type Mood = 'radiant' | 'happy' | 'sleepy' | 'lowPower' | 'lonely';

// The mood ladder lives in the backend (services/db/pet.ts, petMood) and rides
// in on every pet payload, so the rule has exactly one definition. The only
// thing done here is reading it. 'happy' covers a backend older than this
// bundle — a plain default, deliberately not a second copy of the thresholds.
function getMood(pet: PetState): Mood {
  return pet.mood ?? 'happy';
}

const MOOD_PHRASES: Record<Mood, string[]> = {
  radiant: [
    'glowing like a tiny sun',
    'radiating pure chaos energy',
    'vibrating at frequencies unknown to science',
    'achieving maximum floof density',
    'emitting suspicious levels of contentment',
  ],
  happy: [
    'running at optimum silliness',
    'plotting elaborate mischief',
    'considering knocking something off a table',
    'loading zoomies.exe',
    'performing routine antenna calibrations',
  ],
  sleepy: [
    'performing a very important slow blink',
    'entering power-save mode',
    'downloading dreams',
    'rebooting in loaf configuration',
    'conserving chaos for later',
  ],
  lowPower: [
    'making tragic little battery noises',
    'running on emergency reserves',
    'beeping pathetically',
    'displaying low-power warning eyes',
    'dramatically flickering his antenna',
  ],
  lonely: [
    'saving all his mischief for you',
    'staring at the door with big eyes',
    'rehearsing his welcome zoomies',
    'charging his affection lasers',
    'cataloging things to knock over when you return',
  ],
};

// Pick a consistent phrase for this session (changes on page load, not every render)
const moodPhraseIndex = Math.floor(Math.random() * 5);
const MOOD_COPY: Record<Mood, string> = Object.fromEntries(
  Object.entries(MOOD_PHRASES).map(([mood, phrases]) => [mood, phrases[moodPhraseIndex % phrases.length]])
) as Record<Mood, string>;

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em]">
        <span>{label}</span><span>{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <motion.div className="h-full rounded-full" style={{ backgroundColor: color }} animate={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function PetApp({ onClose, themeConfig, themeMode }: PetAppProps) {
  const colors = themeConfig[themeMode];
  const [pet, setPet] = useState<PetState>(freshPet);
  const [events, setEvents] = useState<PetEvent[]>([]);
  // slug -> emblem, straight from the companion records.
  const [sigils, setSigils] = useState<Record<string, string>>({});
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/companions');
        const data = res.ok ? await res.json().catch(() => null) : null;
        const map: Record<string, string> = {};
        for (const c of (data?.companions ?? [])) {
          if (c?.slug && c?.emoji) map[String(c.slug)] = String(c.emoji);
        }
        setSigils(map);
      } catch { /* the ledger falls back to a paw print */ }
    })();
  }, []);
  // A known companion gets its own emblem; the only other actor is the owner.
  const actorSigil = (actor: string): string => sigils[actor] || OWNER_SIGIL;
  const [action, setAction] = useState<PetAction | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(pet.name);
  const mood = useMemo(() => getMood(pet), [pet]);
  // Radiant cats zoom, then loaf — victory laps first, breathing after.
  const [zooming, setZooming] = useState(true);
  useEffect(() => {
    if (mood !== 'radiant') return;
    setZooming(true);
    const timer = window.setTimeout(() => setZooming(false), 4500);
    return () => window.clearTimeout(timer);
  }, [mood]);

  useEffect(() => {
    petApi('/visit').then((data) => {
      if (data?.pet) {
        setPet(petFromServer(data.pet));
        setDraftName(data.pet.name);
      }
      if (data?.events) setEvents(data.events);
    });
  }, []);

  function interact(nextAction: PetAction) {
    if (action) return;
    haptic(nextAction === 'pet' ? 35 : 65);
    setAction(nextAction);
    setPet((current) => ({
      ...current,
      hunger: clamp(current.hunger + (nextAction === 'feed' ? 24 : nextAction === 'play' ? -5 : 0)),
      joy: clamp(current.joy + (nextAction === 'play' ? 22 : nextAction === 'pet' ? 12 : 2)),
      energy: clamp(current.energy + (nextAction === 'nap' ? 28 : nextAction === 'play' ? -11 : 0)),
      bond: clamp(current.bond + (nextAction === 'pet' ? 3 : 1)),
      updatedAt: Date.now(),
    }));
    petApi('/action', { action: nextAction }).then((data) => {
      if (data?.pet) setPet(petFromServer(data.pet));
      petApi('').then((fresh) => fresh?.events && setEvents(fresh.events));
    });
    window.setTimeout(() => setAction(null), ACTION_HOLD_MS[nextAction]);
  }

  function saveName() {
    const name = draftName.trim().slice(0, 18);
    if (name) {
      setPet((current) => ({ ...current, name }));
      petApi('/name', { name }).then((data) => data?.pet && setPet(petFromServer(data.pet)));
    }
    setEditing(false);
  }

  function resetPet() {
    if (!window.confirm('Start over with a new pet?')) return;
    petApi('/reset').then((data) => {
      if (data?.pet) {
        setPet(petFromServer(data.pet));
        setDraftName(data.pet.name);
      }
      setEvents([]);
    });
    setEditing(false);
  }

  const actions = [
    { id: 'feed' as const, label: 'Charge', Icon: BatteryCharging },
    { id: 'play' as const, label: 'Chaos', Icon: Gamepad2 },
    { id: 'nap' as const, label: 'Reboot', Icon: Moon },
    { id: 'pet' as const, label: 'Boop', Icon: Heart },
  ];

  return (
    <AppShell
      title="Familiar"
      icon={PawPrint}
      onClose={onClose}
      themeConfig={themeConfig}
      themeMode={themeMode}
      headerRight={(
        <button onClick={() => setEditing(true)} className={cn('rounded-full p-2 transition-colors hover:bg-black/10 dark:hover:bg-white/10', colors.textMuted)} title="Customize familiar">
          <Brush size={17} />
        </button>
      )}
    >
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-3 pb-4">
        <section className={cn('relative overflow-hidden rounded-xl border backdrop-blur-md', colors.panelBg, colors.panelBorder)}>
          <div
            className="absolute inset-0 opacity-70"
            style={{
              backgroundColor: '#17191c',
              backgroundImage: `linear-gradient(${PET_ACCENT}0d 1px, transparent 1px), linear-gradient(90deg, ${PET_ACCENT}0d 1px, transparent 1px), radial-gradient(circle at 50% 38%, ${PET_ACCENT}2b, transparent 48%)`,
              backgroundSize: '12px 12px, 12px 12px, 100% 100%',
            }}
          />
          <AnimatePresence>
            {(mood === 'radiant' || action === 'pet') && [...Array(6)].map((_, index) => (
              <motion.div
                key={`${action}-${index}`}
                className="absolute"
                style={{ left: `${15 + index * 14}%`, top: `${12 + (index % 3) * 18}%`, color: PET_ACCENT }}
                initial={{ opacity: 0, scale: 0, y: 10 }}
                animate={{ opacity: [0, 1, 0], scale: [0, 1, .4], y: -24 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.8, delay: index * .16, repeat: mood === 'radiant' && !action ? Infinity : 0 }}
              >
                <Sparkles size={14} />
              </motion.div>
            ))}
          </AnimatePresence>

          <div className="relative flex h-[290px] items-center justify-center px-5 pt-3">
            <button onClick={() => interact('pet')} className="h-[250px] w-[250px] touch-manipulation" aria-label={`Boop ${pet.name}`}>
              <Creature mood={mood} action={action} zooming={zooming} />
            </button>
          </div>
          <div className="relative border-t border-black/5 px-5 py-4 text-center dark:border-white/5">
            <div className="flex items-center justify-center gap-2">
              <h2 className={cn('text-2xl font-semibold tracking-tight', colors.textMain)}>{pet.name}</h2>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: PET_ACCENT, backgroundColor: `${PET_ACCENT}18` }}>
                bond {pet.bond}
              </span>
            </div>
            <p className={cn('mt-1 text-xs', colors.textMuted)}>{pet.name} is {MOOD_COPY[mood]}.</p>
          </div>
        </section>

        <section className={cn('grid grid-cols-3 gap-4 rounded-2xl border p-4 backdrop-blur-md', colors.panelBg, colors.panelBorder, colors.textMuted)}>
          <Stat label="Charge" value={pet.hunger} color={PET_ACCENT} />
          <Stat label="Joy" value={pet.joy} color={PET_ACCENT} />
          <Stat label="Energy" value={pet.energy} color={PET_ACCENT} />
        </section>

        <div className="grid grid-cols-4 gap-2">
          {actions.map(({ id, label, Icon }) => (
            <motion.button
              key={id}
              whileTap={{ scale: .94 }}
              onClick={() => interact(id)}
              disabled={Boolean(action)}
              className={cn('flex flex-col items-center gap-1.5 rounded-2xl border py-3 text-xs font-semibold backdrop-blur-md disabled:opacity-50', colors.panelBg, colors.panelBorder, colors.textMain)}
            >
              <Icon size={19} style={{ color: PET_ACCENT }} />
              {label}
            </motion.button>
          ))}
        </div>

        {events.length > 0 && (
          <section className={cn('rounded-2xl border px-4 py-3 backdrop-blur-md', colors.panelBg, colors.panelBorder)}>
            <div className={cn('mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em]', colors.textMuted)}>Visit ledger</div>
            <div className="flex flex-col gap-1">
              {events.slice(0, 4).map((event) => (
                <div key={event.id} className={cn('flex items-center justify-between text-xs', colors.textMain)}>
                  <span>{actorSigil(event.actor)} {EVENT_VERBS[event.action] || event.action}</span>
                  <span className={cn('text-[10px]', colors.textMuted)}>{timeAgo(event.created_at)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className={cn('flex items-center justify-center gap-5 py-1 text-[10px] uppercase tracking-[0.12em]', colors.textMuted)}>
          <span>{pet.visits} visits</span><span>•</span><span>{Math.max(1, Math.floor((Date.now() - pet.createdAt) / 86_400_000) + 1)} days together</span>
        </div>
      </div>

      <AnimatePresence>
        {editing && (
          <motion.div className="absolute inset-0 z-50 flex items-end bg-black/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditing(false)}>
            <motion.div
              className={cn('w-full rounded-t-[2rem] border-t p-5 pb-[calc(var(--sab)+1.25rem)] shadow-2xl', colors.pageBg, colors.panelBorder, colors.textMain)}
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-5 flex items-center justify-between">
                <div><div className="text-lg font-semibold">Make him yours</div><div className={cn('text-xs', colors.textMuted)}>He lives on the house server — everyone can visit.</div></div>
                <button onClick={() => setEditing(false)} className={cn('rounded-full p-2', colors.textMuted)}><X size={19} /></button>
              </div>

              <label className={cn('mb-2 block text-[10px] font-bold uppercase tracking-[0.12em]', colors.textMuted)}>Name</label>
              <div className="mb-5 flex gap-2">
                <input value={draftName} onChange={(event) => setDraftName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && saveName()} maxLength={18} className={cn('aerie-field min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm outline-none', colors.textMain)} />
                <button onClick={saveName} className="rounded-xl px-4 text-sm font-semibold text-white" style={{ backgroundColor: PET_ACCENT }}>Save</button>
              </div>

              <button onClick={resetPet} className={cn('flex items-center gap-2 text-xs', colors.textMuted)}><RotateCcw size={14} /> Start over</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}
