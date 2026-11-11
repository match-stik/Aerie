// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The Radar (theirs, Nov 11 2026: 'Just seemed very plain'). Their person in the
// middle, each companion's face round the dial in their own color with their
// status on the corner, and a beam that turns and pings each face as it
// passes. Nearness means something without a map: whoever spoke most recently
// sits closest, whoever has been quiet drifts out toward the rim
// (lib/radar.ts). Tap a face for where they are. The compass ring still turns
// with the phone's heading.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Compass, Mountain } from 'lucide-react';
import { ThemeConfig } from '../lib/theme';
import { cn } from '../lib/utils';
import { useAerie } from '../aerie';
import { getOwnerAvatar } from '../lib/house';
import { liveStatus, refreshStatuses, useMinuteClock } from '../lib/statuses';
import { HOME_WORD } from '../lib/presence-word';
import { asSpoken, lastHeardBySlug, ringFor, seatAngle, sweptPast } from '../lib/radar';
import { StatusIcon } from './Statuses';
import type { CustomEmoji } from '../types';

interface Companion {
  id: string;
  slug: string;
  display_name: string;
  color: string | null;
  avatar_url: string | null;
  emoji: string | null;
}

interface RadarAppProps {
  onClose: () => void;
  themeConfig: ThemeConfig;
  themeMode: 'light' | 'dark';
  companions: Companion[];
  customEmojis?: CustomEmoji[];
}

/** A color at some strength. The accent arrives as a CSS variable, so a hex alpha suffix would not parse. */
function fade(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

/** One full turn of the beam. */
const SWEEP_MS = 6000;

function Face({ c, size, ring }: { c: Companion; size: number; ring: string }) {
  return (
    <div
      className="rounded-full overflow-hidden flex items-center justify-center bg-black"
      style={{ width: size, height: size, boxShadow: `0 0 0 2px ${ring}, 0 0 14px ${fade(ring, 50)}` }}
    >
      {c.avatar_url
        ? <img src={c.avatar_url} alt="" className="h-full w-full object-cover" draggable={false} />
        : <span className="text-white text-sm font-semibold">{c.emoji || c.display_name.slice(0, 1)}</span>}
    </div>
  );
}

export function RadarApp({ onClose, themeConfig, themeMode, companions, customEmojis }: RadarAppProps) {
  const colors = themeConfig[themeMode];

  // Force a brighter accent for the dark radar background on specific light themes
  let radarAccent = colors.accent;
  if (themeMode === 'light') {
    if (themeConfig.id === 'monochrome') radarAccent = '#FFFFFF';
    if (themeConfig.id === 'cobalt') radarAccent = '#A1A1AA'; // Use the dark mode steel accent
  }

  const stars = useMemo(() => {
    return Array.from({ length: 150 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 0.5,
      opacity: Math.random() * 0.5 + 0.1,
      twinkleDelay: Math.random() * 5,
      twinkle: 3 + Math.random() * 2,
    }));
  }, []);

  const now = useMinuteClock();
  const statuses = useAerie((s) => s.statuses);
  const messages = useAerie((s) => s.messages);
  useEffect(() => { void refreshStatuses(); }, []);

  const heard = useMemo(() => lastHeardBySlug(asSpoken(messages), companions), [messages, companions]);
  const seats = useMemo(() => companions.map((c, i) => ({
    c,
    angle: seatAngle(i, companions.length),
    ring: ringFor(heard[c.slug], now),
    color: c.color || radarAccent,
    status: liveStatus(statuses.companions[c.slug], now),
  })), [companions, heard, now, statuses, radarAccent]);

  // The beam, and a ping on each face as it passes.
  const [sweep, setSweep] = useState(0);
  const [pings, setPings] = useState<Record<string, number>>({});
  const prevSweep = useRef(0);
  const seatsRef = useRef(seats);
  seatsRef.current = seats;
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const next = (((t - start) % SWEEP_MS) / SWEEP_MS) * 360;
      const passed = seatsRef.current.filter((s) => sweptPast(prevSweep.current, next, s.angle)).map((s) => s.c.slug);
      prevSweep.current = next;
      setSweep(next);
      if (passed.length) setPings((p) => {
        const out = { ...p };
        for (const slug of passed) out[slug] = (out[slug] || 0) + 1;
        return out;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const [selected, setSelected] = useState<string | null>(null);
  const picked = seats.find((s) => s.c.slug === selected) || null;
  const owner = getOwnerAvatar();

  const [heading, setHeading] = useState<number | null>(null);
  const [altitude, setAltitude] = useState<number | null>(null);

  // Sensors for Compass and Altimeter
  useEffect(() => {
    let watchId: number | null = null;
    const handleOrientation = (event: DeviceOrientationEvent) => {
      let alpha = event.alpha;
      // iOS webkit compass heading
      if ((event as any).webkitCompassHeading) alpha = (event as any).webkitCompassHeading;
      if (alpha !== null) setHeading(alpha);
    };
    if (window.DeviceOrientationEvent) window.addEventListener('deviceorientation', handleOrientation, true);
    if ('geolocation' in navigator) {
      watchId = navigator.geolocation.watchPosition(
        (position) => { if (position.coords.altitude !== null) setAltitude(Math.round(position.coords.altitude)); },
        () => { /* no altitude: the box stays hidden */ },
        { enableHighAccuracy: true },
      );
    }
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation, true);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  return (
    <motion.div
      className={cn("absolute inset-0 z-50 flex flex-col", colors.textMain)}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
    >
      <header
        className={cn("aerie-shell-header flex items-center gap-3 px-4 pb-3", colors.pageBg)}
        style={{ paddingTop: 'calc(var(--sat) + 0.75rem)' }}
      >
        <button
          onClick={onClose}
          className={cn("p-1.5 rounded-full transition-colors", colors.textMuted, "hover:bg-black/10 dark:hover:bg-white/10")}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className={cn("text-lg font-semibold", colors.textMain)}>Radar</h1>
        </div>
      </header>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-6 bg-black" onClick={() => setSelected(null)}>
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute inset-0 opacity-30"
            style={{
              background: `radial-gradient(circle at 30% 40%, ${fade(radarAccent, 25)} 0%, transparent 40%),
                           radial-gradient(circle at 70% 60%, ${fade(radarAccent, 12)} 0%, transparent 50%)`
            }}
          />
          {stars.map(star => (
            <motion.div
              key={star.id}
              className="absolute rounded-full bg-white"
              style={{ left: `${star.x}%`, top: `${star.y}%`, width: `${star.size}px`, height: `${star.size}px`, opacity: star.opacity }}
              animate={{ opacity: [star.opacity, star.opacity * 2, star.opacity] }}
              transition={{ duration: star.twinkle, repeat: Infinity, delay: star.twinkleDelay }}
            />
          ))}
        </div>

        {/* Instruments: each one only when the phone can read it */}
        <div className="absolute top-6 left-6 right-6 flex justify-between items-start z-20 pointer-events-none">
          {heading !== null ? (
            <div className="flex flex-col gap-1 bg-black/40 p-3 rounded-[var(--shape-surface)] border border-white/10">
              <div className="flex items-center gap-2 text-white/70 mb-1">
                <Compass className="h-4 w-4" style={{ color: radarAccent }} />
                <span className="text-[10px] font-bold uppercase tracking-widest">Heading</span>
              </div>
              <span className="text-2xl font-light text-white tracking-tighter">{Math.round(heading)}°</span>
            </div>
          ) : <span />}
          {altitude !== null && (
            <div className="flex flex-col gap-1 bg-black/40 p-3 rounded-[var(--shape-surface)] border border-white/10 items-end">
              <div className="flex items-center gap-2 text-white/70 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-widest">Altitude</span>
                <Mountain className="h-4 w-4" style={{ color: radarAccent }} />
              </div>
              <span className="text-2xl font-light text-white tracking-tighter">{altitude}m</span>
            </div>
          )}
        </div>

        <div
          className="relative aspect-square w-full max-w-md rounded-full border"
          style={{ borderColor: fade(radarAccent, 32), background: `radial-gradient(circle, ${fade(radarAccent, 8)} 0%, transparent 70%)` }}
        >
          {/* Compass ring, turning with the phone */}
          <motion.div
            className="absolute -inset-6 rounded-full border-2 border-dashed opacity-30 pointer-events-none"
            style={{ borderColor: radarAccent, rotate: -(heading ?? 0) }}
          >
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-xs font-bold text-white">N</div>
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-xs font-bold text-white">S</div>
            <div className="absolute top-1/2 -right-4 -translate-y-1/2 text-xs font-bold text-white">E</div>
            <div className="absolute top-1/2 -left-4 -translate-y-1/2 text-xs font-bold text-white">W</div>
          </motion.div>

          {/* Rings and crosshairs */}
          {[0.84, 0.54, 0.24].map((r) => (
            <div
              key={r}
              className="absolute rounded-full border opacity-30 pointer-events-none"
              style={{ borderColor: radarAccent, inset: `${(1 - r) * 50}%` }}
            />
          ))}
          <div className="absolute inset-x-1/2 top-0 bottom-0 w-px opacity-20 pointer-events-none" style={{ backgroundColor: radarAccent }} />
          <div className="absolute inset-y-1/2 left-0 right-0 h-px opacity-20 pointer-events-none" style={{ backgroundColor: radarAccent }} />

          {/* The beam */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: `conic-gradient(from ${sweep - 70}deg, ${fade(radarAccent, 0)} 0deg, ${fade(radarAccent, 18)} 45deg, ${fade(radarAccent, 55)} 70deg, transparent 70.5deg)`,
            }}
          />
          <div
            className="absolute left-1/2 top-1/2 h-1/2 w-px origin-top pointer-events-none"
            style={{ backgroundColor: radarAccent, opacity: 0.8, transform: `rotate(${sweep + 180}deg)`, boxShadow: `0 0 8px ${radarAccent}` }}
          />

          {/* Their person, in the middle */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
            {owner.url ? (
              <div className="h-10 w-10 rounded-full overflow-hidden" style={{ boxShadow: `0 0 0 2px ${owner.color || radarAccent}, 0 0 16px ${owner.color || radarAccent}` }}>
                <img src={owner.url} alt="" className="h-full w-full object-cover" draggable={false} />
              </div>
            ) : (
              <div className="h-4 w-4 rounded-full" style={{ backgroundColor: owner.color || radarAccent, boxShadow: `0 0 16px ${owner.color || radarAccent}` }} />
            )}
          </div>

          {/* The companions */}
          {seats.map(({ c, angle, ring, color, status }) => {
            const rad = (angle * Math.PI) / 180;
            const x = 50 + Math.sin(rad) * ring * 50;
            const y = 50 - Math.cos(rad) * ring * 50;
            const isPicked = selected === c.slug;
            return (
              <motion.button
                key={c.id}
                type="button"
                className="absolute z-10 flex flex-col items-center"
                style={{ left: `${x}%`, top: `${y}%`, x: '-50%', y: '-50%' }}
                initial={false}
                animate={{ left: `${x}%`, top: `${y}%` }}
                transition={{ type: 'spring', stiffness: 60, damping: 18 }}
                onClick={(e) => { e.stopPropagation(); setSelected(isPicked ? null : c.slug); }}
                aria-label={`${c.display_name}: ${status?.text || HOME_WORD}`}
              >
                <div className="relative">
                  <AnimatePresence>
                    <motion.div
                      key={pings[c.slug] || 0}
                      className="absolute inset-0 rounded-full pointer-events-none"
                      style={{ border: `2px solid ${color}` }}
                      initial={{ scale: 1, opacity: 0.9 }}
                      animate={{ scale: 2.2, opacity: 0 }}
                      transition={{ duration: 1.4, ease: 'easeOut' }}
                    />
                  </AnimatePresence>
                  <motion.div
                    key={`glow-${pings[c.slug] || 0}`}
                    initial={{ filter: 'brightness(1.6)' }}
                    animate={{ filter: 'brightness(1)' }}
                    transition={{ duration: 1.2 }}
                  >
                    <Face c={c} size={isPicked ? 40 : 34} ring={color} />
                  </motion.div>
                  {status?.icon && (
                    <span className="absolute -bottom-1 -right-2 h-5 min-w-5 px-0.5 rounded-full bg-black/80 border border-white/20 flex items-center justify-center text-xs">
                      <StatusIcon icon={status.icon} customEmojis={customEmojis} />
                    </span>
                  )}
                </div>
                <span className="mt-1 text-[9px] font-medium tracking-[.16em] uppercase text-white">{c.display_name}</span>
              </motion.button>
            );
          })}
        </div>

        {/* Where the tapped one is */}
        <AnimatePresence>
          {picked && (
            <motion.div
              key={picked.c.slug}
              className="absolute bottom-5 left-5 right-5 z-30 flex items-center gap-3 rounded-[var(--shape-surface)] border border-white/15 bg-black/80 p-3"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              onClick={(e) => e.stopPropagation()}
            >
              <Face c={picked.c} size={36} ring={picked.color} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white">{picked.c.display_name}</div>
                <div className="flex items-center gap-1.5 text-xs text-white/75">
                  {picked.status?.icon && <StatusIcon icon={picked.status.icon} customEmojis={customEmojis} />}
                  <span className="truncate">{picked.status?.text || HOME_WORD}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Where everyone is */}
      <div className={cn("border-t px-4 py-3 z-10", colors.panelBg, colors.panelBorder)}>
        <div className="flex flex-col gap-2">
          {seats.map(({ c, color, status }) => (
            <button
              key={c.id}
              type="button"
              className="flex items-center gap-2.5 text-left"
              onClick={() => setSelected(selected === c.slug ? null : c.slug)}
            >
              <Face c={c} size={22} ring={color} />
              <span className={cn("text-xs font-semibold", colors.textMain)}>{c.display_name}</span>
              <span className={cn("flex min-w-0 items-center gap-1 text-xs", colors.textMuted)}>
                {status?.icon && <StatusIcon icon={status.icon} customEmojis={customEmojis} />}
                <span className="truncate">{status?.text || HOME_WORD}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
