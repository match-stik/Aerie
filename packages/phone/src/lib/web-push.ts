// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Web push for a browser (theirs, Oct 29 2026: both options in the kit, for
// people without the Android app). The Android app never comes here; it uses
// Firebase. The worker lives at /push-sw.js under a scope no page sits in, so
// it never controls a page or sees a request (see the comment at its top).

const SCOPE = '/__aerie-push/';

export function webPushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

function keyBytes(base64url: string): Uint8Array {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Ask, subscribe and tell the house. Answers a sentence for them when it can't. */
export async function enableWebPush(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!webPushSupported()) return { ok: false, reason: 'This browser cannot receive push notifications. On an iPhone, add the house to your home screen from Safari first.' };
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'Notifications are blocked for this site in the browser settings.' };
  const keyRes = await fetch('/api/push/vapid-public', { credentials: 'include' });
  const { publicKey } = await keyRes.json().catch(() => ({ publicKey: null })) as { publicKey: string | null };
  if (!publicKey) return { ok: false, reason: 'The house could not make its push key. Check the server log.' };
  const reg = await navigator.serviceWorker.register('/push-sw.js', { scope: SCOPE });
  await navigator.serviceWorker.ready.catch(() => undefined);
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, deviceLabel: navigator.userAgent.slice(0, 80) }),
  });
  if (!res.ok) return { ok: false, reason: 'The house did not accept this browser. Try again in a moment.' };
  return { ok: true };
}

/** Turn it off for this browser only. */
export async function disableWebPush(): Promise<void> {
  if (!webPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration(SCOPE);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await fetch('/api/push/unsubscribe', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
  await reg?.unregister().catch(() => undefined);
}
