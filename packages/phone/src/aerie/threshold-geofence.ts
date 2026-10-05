// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The Android half of Thresholds.
//
// A threshold used to open only if the owner opened Aerie, walked to Thresholds and
// tapped "find where I am" while standing in the place. This hands the owner's own pins
// to the operating system so the phone watches them with Aerie shut, and the
// privacy shape survives whole: Android does the watching locally, says only
// "a region was entered", and no coordinate ever leaves the device or reaches
// the house. We learn that a door opened. We never learn where the owner is.

import { Capacitor, registerPlugin } from '@capacitor/core';
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
