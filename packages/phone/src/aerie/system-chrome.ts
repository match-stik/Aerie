// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The APK's system bars. The installed web app follows the theme-color meta
// on its own; inside the APK both bars belong to the native window, and only
// the app's SystemChrome plugin reaches them.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { opaqueHex } from '../lib/status-bar-color';

interface SystemChromeBridge {
  setStatusBar(options: { color: string }): Promise<void>;
  setNavigationBar(options: { color: string }): Promise<void>;
}

const SystemChrome = registerPlugin<SystemChromeBridge>('SystemChrome');

/** Paints the status bar and the navigation strip one color. Each is asked
 *  separately, so an APK that has only the first (1.37) still paints the top,
 *  and one from before the plugin keeps its black bars; those refusals are
 *  swallowed. */
export async function paintSystemBars(color: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const hex = opaqueHex(color);
  if (!hex) return;
  try {
    await SystemChrome.setStatusBar({ color: hex });
  } catch {
    // An APK older than 1.37, which never had the plugin.
  }
  try {
    await SystemChrome.setNavigationBar({ color: hex });
  } catch {
    // An APK older than 1.38, which could only reach the top.
  }
}
