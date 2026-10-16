// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Lovense: this file drives Lovense toys. Running Aerie needs your own Lovense
// developer account and token; carrying this code into another project needs
// that project's own agreement and approval from Lovense. See
// packages/phone/android/LOVENSE.md.
// The page's half of the owner's toys: Lovense's Android SDK inside the app
// (LovenseToysPlugin), reaching the toys over Bluetooth with no Lovense Remote
// and no cloud in between.
//
// The owner's stop is the first thing here and the one call that never waits on
// anything else: the native side starts its hold before it queues a single
// zero, and refuses every motion for a few seconds after, so a slider still
// sending or a command already on its way cannot start a toy back up.
//
// The developer token is read from the house when it is needed and handed
// straight to the SDK; the app file never carries it.

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { apiFetch } from './api';

export interface LovenseToy {
  toyId: string;
  name?: string;
  type?: string;
  fullName?: string;
  deviceType?: string;
  version?: string;
  battery?: number;
  rssi?: number;
  connected: boolean;
  /** The SDK's CommandType names this toy answers to, e.g. FLEXER_FINGER. */
  commands: string[];
}

export interface ToysStatus {
  bluetoothSupported: boolean;
  bluetoothOn: boolean;
  /** Nearby-devices permission on Android 12 and up, location before it. */
  permitted: boolean;
  tokenSet: boolean;
  /** How much longer the owner's last stop refuses commands, in ms. */
  holdMs: number;
  toys: LovenseToy[];
}

export interface ToyConnection {
  toyId: string;
  /** connecting | connected | failed | service_discovered, as the SDK says it. */
  state: string;
}

export interface ToyError {
  toyId?: string;
  code?: number;
  message?: string;
}

interface LovenseToysBridge {
  status(): Promise<ToysStatus>;
  requestAccess(): Promise<ToysStatus>;
  setToken(options: { token: string }): Promise<ToysStatus>;
  search(): Promise<void>;
  stopSearch(): Promise<void>;
  connect(options: { toyId: string }): Promise<void>;
  disconnect(options: { toyId: string }): Promise<void>;
  toys(): Promise<{ toys: LovenseToy[] }>;
  command(options: { toyId: string; command: string; level?: number }): Promise<void>;
  stop(): Promise<{ stopped: number; holdMs: number }>;
  addListener(event: 'toyFound', fn: (toy: LovenseToy) => void): Promise<PluginListenerHandle>;
  addListener(event: 'searchFinished', fn: () => void): Promise<PluginListenerHandle>;
  addListener(event: 'connection', fn: (c: ToyConnection) => void): Promise<PluginListenerHandle>;
  addListener(event: 'battery', fn: (b: { toyId: string; level: number; working: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'toyError', fn: (e: ToyError) => void): Promise<PluginListenerHandle>;
  addListener(event: 'stopped', fn: (s: { stopped: number; holdMs: number }) => void): Promise<PluginListenerHandle>;
}

export const LovenseToys = registerPlugin<LovenseToysBridge>('LovenseToys');

/** True only inside an installed app new enough to carry the toy bridge. An
 *  older app, or the page in a browser, gets false and is told to update. */
export function hasToyBridge(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('LovenseToys');
}

/** The owner's stop. Never debounced, never queued behind anything on this side. */
export async function stopAllToys(): Promise<{ stopped: number; holdMs: number } | null> {
  if (!hasToyBridge()) return null;
  return LovenseToys.stop();
}

/** Read the developer token from the house and hand it to the SDK. Returns
 *  false with a reason the page can say plainly when there is none. */
export async function handInToken(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!hasToyBridge()) return { ok: false, reason: 'This app does not have the toy bridge yet.' };
  const res = await apiFetch('/api/secrets/lovense_developer_token');
  if (res.status === 404) return { ok: false, reason: 'No Lovense developer token in Secrets yet.' };
  if (!res.ok) return { ok: false, reason: `The house would not hand over the token (${res.status}).` };
  let value = '';
  try {
    const body = (await res.json()) as { value?: unknown };
    value = typeof body.value === 'string' ? body.value : '';
  } catch {
    return { ok: false, reason: 'The house answered with something that was not the token.' };
  }
  if (!value.trim()) return { ok: false, reason: 'The Lovense developer token in Secrets is empty.' };
  await LovenseToys.setToken({ token: value });
  return { ok: true };
}

export { motorsFor, presetsFor, type ToyMotor } from '../lib/toy-motors';
