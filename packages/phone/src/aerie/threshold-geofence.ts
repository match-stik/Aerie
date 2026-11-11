// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The Android half of Thresholds.
//
// A threshold used to open only if their person opened Aerie, walked to Thresholds and
// tapped "find where I am" while standing in the place. This hands their person's own pins
// to the operating system so the phone watches them with Aerie shut, and the
// privacy shape survives whole: Android does the watching locally, says only
// "a region was entered", and no coordinate ever leaves the device or reaches
// the house. We learn that a door opened. We never learn where their person is.

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { apiFetch } from './api';
import { regionsFor, type ArmedPlace } from '../lib/geofence-regions';

export interface GeofenceStatus {
  /** Play Services present — geofencing lives there, not in the platform SDK. */
  supported: boolean;
  fineLocation: boolean;
  /** The "allow all the time" grant. Without it nothing is registered. */
  backgroundLocation: boolean;
  /** Android 10+ makes the always-on grant a trip to Settings the user must take. */
  needsSettingsTrip: boolean;
  registered?: number;
  reason?: string;
}

interface ThresholdGeofenceBridge {
  status(): Promise<GeofenceStatus>;
  sync(options: { places: ArmedPlace[] }): Promise<GeofenceStatus>;
  clear(): Promise<GeofenceStatus>;
  openSettings(): Promise<{ opened: boolean }>;
  takeArrival(): Promise<{ placeId?: string; at?: number }>;
  addListener(event: 'arrival', fn: (a: { placeId?: string; at?: number }) => void): Promise<PluginListenerHandle>;
}

const ThresholdGeofence = registerPlugin<ThresholdGeofenceBridge>('ThresholdGeofence');

const UNAVAILABLE: GeofenceStatus = {
  supported: false,
  fineLocation: false,
  backgroundLocation: false,
  needsSettingsTrip: false,
  registered: 0,
};

export function hasNativeGeofence(): boolean {
  return Capacitor.getPlatform() === 'android';
}

async function quietly<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    console.warn('[Thresholds] geofence bridge unavailable:', error);
    return fallback;
  }
}

export async function geofenceStatus(): Promise<GeofenceStatus> {
  if (!hasNativeGeofence()) return UNAVAILABLE;
  return quietly(() => ThresholdGeofence.status(), UNAVAILABLE);
}

export async function openLocationSettings(): Promise<boolean> {
  if (!hasNativeGeofence()) return false;
  const result = await quietly(() => ThresholdGeofence.openSettings(), { opened: false });
  return result.opened;
}

export async function clearGeofences(): Promise<GeofenceStatus> {
  if (!hasNativeGeofence()) return UNAVAILABLE;
  return quietly(() => ThresholdGeofence.clear(), UNAVAILABLE);
}

/**
 * Ask the house which places are worth watching and hand exactly those to the
 * operating system. Safe to call on every launch and after anything changes;
 * the native side replaces the whole set rather than adding to it, so a place
 * that stops having something waiting stops being watched.
 */
export async function syncArmedPlaces(): Promise<GeofenceStatus> {
  if (!hasNativeGeofence()) return UNAVAILABLE;

  const status = await geofenceStatus();
  // No point spending a request on a list we are not allowed to register, and
  // no point pretending otherwise — the caller gets the honest reason back.
  if (!status.supported || !status.backgroundLocation) return { ...status, registered: 0 };

  const places = await quietly(async () => {
    const res = await apiFetch('/api/thresholds/armed');
    // A backend older than this route answers 200 with the app's own HTML off
    // the SPA fallback, so res.ok proves nothing. Shape is the only witness.
    if (!res.ok) return [];
    const body: unknown = await res.json().catch(() => null);
    if (!body || typeof body !== 'object' || !Array.isArray((body as { places?: unknown }).places)) return [];
    return regionsFor((body as { places: unknown[] }).places);
  }, [] as ArmedPlace[]);

  return quietly(() => ThresholdGeofence.sync({ places }), { ...status, registered: 0 });
}

/** A tapped arrival notice: which place, and when the phone saw them arrive. */
export interface Arrival { placeId: string; at: number }

/** The OS already waited out the 90 s dwell, so an arrival this fresh counts
 *  as standing there; an old notice tapped hours later only opens the place. */
export const ARRIVAL_FRESH_MS = 30 * 60 * 1000;

let waitingArrival: Arrival | null = null;
const arrivalListeners = new Set<(a: Arrival) => void>();

function asArrival(raw: { placeId?: string; at?: number } | null | undefined): Arrival | null {
  if (!raw || typeof raw.placeId !== 'string' || !raw.placeId) return null;
  return { placeId: raw.placeId, at: typeof raw.at === 'number' ? raw.at : Date.now() };
}

function hand(a: Arrival) {
  waitingArrival = a;
  for (const fn of arrivalListeners) fn(a);
}

/**
 * Tapping 'Something is waiting here.' used to land wherever the app last was
 * (reported by Sol, Nov 9 2026). The notice now carries its place;
 * this asks for one left by a cold start and listens for taps while the app is
 * open, and calls onArrive for each. Returns a stop function.
 */
export function watchArrivals(onArrive: (a: Arrival) => void): () => void {
  if (!hasNativeGeofence()) return () => {};
  arrivalListeners.add(onArrive);
  let handle: PluginListenerHandle | null = null;
  let stopped = false;
  void quietly(() => ThresholdGeofence.takeArrival(), {}).then((raw) => {
    const a = asArrival(raw);
    if (a && !stopped) hand(a);
  });
  void quietly(() => ThresholdGeofence.addListener('arrival', (raw) => {
    const a = asArrival(raw);
    if (a) hand(a);
  }), null).then((h) => { if (stopped) h?.remove(); else handle = h; });
  return () => { stopped = true; arrivalListeners.delete(onArrive); handle?.remove(); };
}

/** The arrival Thresholds should open at, handed over once. */
export function takeWaitingArrival(): Arrival | null {
  const a = waitingArrival;
  waitingArrival = null;
  return a;
}

/** Thresholds, while open, hears an arrival tapped right then. */
export function onArrivalWhileOpen(fn: (a: Arrival) => void): () => void {
  arrivalListeners.add(fn);
  return () => { arrivalListeners.delete(fn); };
}
