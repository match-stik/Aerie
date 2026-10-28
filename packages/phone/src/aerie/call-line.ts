// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * Whether a call's reply plays on the CALL line rather than the music line.
 *
 * Theirs, Oct 27 2026: with Aerie in the background and the call dock floating,
 * every reply played about a second over their car's Bluetooth and stopped. Off
 * screen the call keeps their mic open between turns (mic-hold.ts), an open mic
 * keeps the car in phone-call mode, and the car shuts off anything sent to it
 * as music. The CallVoice plugin (CallVoicePlugin.java) plays the reply as a
 * voice call instead.
 *
 * Only while the page is hidden, because on screen the mic is handed back
 * before the reply plays and the music line works and sounds fuller; and only
 * over Bluetooth, because on the phone's own speaker a voice call comes out of
 * the earpiece. An APK without the plugin keeps the old road.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface CallLineInput {
  /** The app has the CallVoice plugin (APK 1.51 and up). */
  pluginAvailable: boolean;
  /** The page is hidden, so the call is holding the mic open. */
  pageHidden: boolean;
  /** The phone says the call is running over a Bluetooth head unit. */
  bluetoothCall: boolean;
}

export function shouldUseCallLine(input: CallLineInput): boolean {
  return input.pluginAvailable && input.pageHidden && input.bluetoothCall;
}

interface CallVoiceBridge {
  play(options: { url: string }): Promise<{ ended?: boolean }>;
  stop(): Promise<void>;
  getRoute(): Promise<{ bluetoothCall: boolean; mode?: number }>;
}

export const CallVoice = registerPlugin<CallVoiceBridge>('CallVoice');

export function callVoiceAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('CallVoice');
  } catch {
    return false;
  }
}

/** The phone's own answer, or false when it can't give one. */
export async function readBluetoothCall(): Promise<boolean> {
  try {
    const route = await CallVoice.getRoute();
    return route?.bluetoothCall === true;
  } catch {
    return false;
  }
}

/** A house address the native player can open: it has no page to be relative to. */
export function absoluteVoiceUrl(url: string, base: string): string {
  return new URL(url, base).toString();
}
