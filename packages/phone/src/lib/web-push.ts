// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Web push for a browser. The Android app never comes here; it uses
// Firebase. The worker lives at /push-sw.js under a scope no page sits in, so
// it never controls a page or sees a request (see the comment at its top).

import { apiFetch } from '../aerie/api';

const SCOPE = '/__aerie-push/';

export function webPushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** The Aerie app on their laptop (desktop/main.cjs) shows notifications itself while it runs; it has no push service to subscribe to. */
function inLaptopApp(): boolean {
  return typeof window !== 'undefined' && typeof (window as { aerieDesktop?: unknown }).aerieDesktop === 'object';
}

/**
 * A worker registered for a scope no page sits in never makes
 * navigator.serviceWorker.ready resolve (that promise waits for one serving
 * this page), so waiting on it hung the switch forever after the browser's
 * own question.
 * This waits for this registration's own worker instead, with a ceiling.
 */
function activeWorker(reg: ServiceWorkerRegistration, ms = 10_000): Promise<boolean> {
  if (reg.active) return Promise.resolve(true);
  const worker = reg.installing ?? reg.waiting;
  if (!worker) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(Boolean(reg.active)), ms);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') { clearTimeout(timer); resolve(true); }
      if (worker.state === 'redundant') { clearTimeout(timer); resolve(false); }
    });
  });
}

/** Ask, subscribe and tell the house. Answers a sentence for them when it can't. */
export async function enableWebPush(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (inLaptopApp()) {
    // The app shows them from the conversation itself whenever it is out of sight.
    const permission = typeof Notification === 'undefined' ? 'denied' : await Notification.requestPermission();
    return permission === 'granted' ? { ok: true } : { ok: false, reason: 'Windows is not letting the Aerie app show notifications. Check Settings > System > Notifications.' };
  }
  if (!webPushSupported()) return { ok: false, reason: 'This browser cannot receive push notifications. On an iPhone, add the house to your home screen from Safari first.' };
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: 'Notifications are blocked for this site in the browser settings.' };
    const keyRes = await apiFetch('/api/push/vapid-public');
    const { publicKey } = await keyRes.json().catch(() => ({ publicKey: null })) as { publicKey: string | null };
    if (!publicKey) return { ok: false, reason: 'The house could not make its push key. Check the server log.' };
    const reg = await navigator.serviceWorker.register('/push-sw.js', { scope: SCOPE });
    if (!await activeWorker(reg)) return { ok: false, reason: 'The browser would not start the notification helper. Try again in a moment.' };
    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    // Through apiFetch, which carries the house's cross-site token; a bare
    // fetch was refused here once the house started enforcing it.
    const res = await apiFetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, deviceLabel: navigator.userAgent.slice(0, 80) }),
    });
    if (!res.ok) return { ok: false, reason: 'The house did not accept this browser. Try again in a moment.' };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `The browser said no: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Turn it off for this browser only. */
export async function disableWebPush(): Promise<void> {
  if (inLaptopApp() || !webPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration(SCOPE);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await apiFetch('/api/push/unsubscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
  await reg?.unregister().catch(() => undefined);
}
