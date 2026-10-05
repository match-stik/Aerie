// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Opening a link that is not ours, without losing the app.
 *
 * There is no second tab inside the Android WebView. A target="_blank" anchor
 * therefore REPLACES Aerie — and coming back remounts it, which reinitialises
 * osState to 'locked', so following a link reads as being thrown out to the
 * lock screen. The Files app hit this twice and worked around it by refusing to
 * leave; every other link in the app still did it.
 *
 * @capacitor/browser opens a system browser sheet OVER the app instead, so
 * Aerie is still standing behind it when the user comes back.
 *
 * THE CATCH, and it is why this feature-detects rather than assuming: a
 * Capacitor plugin has a native half, so the installed APK has to have been
 * built with it. On an APK that predates it, isPluginAvailable('Browser') is
 * false and this falls back to exactly today's behaviour rather than throwing
 * — a link that behaves as it always has beats a link that does nothing.
 */
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

/** Which road a link should take. Split out so it can be tested without a WebView. */
export type ExternalOpenRoute = 'browser-sheet' | 'new-tab';

export function externalOpenRoute(isNative: boolean, hasBrowserPlugin: boolean): ExternalOpenRoute {
  return isNative && hasBrowserPlugin ? 'browser-sheet' : 'new-tab';
}

/** Only ever hand a real web address to a browser. */
export function isOpenableExternalUrl(url: string | null | undefined): boolean {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function openExternal(url: string): Promise<void> {
  if (!isOpenableExternalUrl(url)) return;
  const route = externalOpenRoute(Capacitor.isNativePlatform(), Capacitor.isPluginAvailable('Browser'));
  if (route === 'browser-sheet') {
    try {
      await Browser.open({ url });
      return;
    } catch {
      // Fall through rather than swallowing the user's tap.
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
