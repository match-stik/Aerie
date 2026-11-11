// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// PushService — FCM (Firebase Cloud Messaging) HTTP v1 transport.
//
// The earlier web-push (PWA) transport was removed because the service worker
// fired notification/click events the rest of the app misread as live
// activity. This replaces it with the platform transport the APK actually
// uses: @capacitor/push-notifications registers with FCM on the device and
// posts its token to /api/push/subscribe; this service signs a service-account
// JWT, exchanges it for an access token, and posts messages to FCM.
//
// Credentials live in the DB secrets store under `fcm_service_account` (the
// whole service-account JSON as downloaded from Firebase). Nothing is read
// from a repo file — house rule.

import { createSign } from 'crypto';
import { registry } from './ws/connection-registry.js';
import { getSecret, setSecret } from './secrets.js';
import webpush from 'web-push';
import {
  listPushSubscriptions,
  removePushSubscription,
  removePushSubscriptionByToken,
  touchPushSubscriptionById,
} from './db/push.js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export interface PushPayload {
  title: string;
  body: string;
  threadId?: string;
  tag?: string;
  url?: string;
  /** Seconds the push service holds it for a browser that's away; default an hour. */
  ttl?: number;
  /** A call from us: the browser keeps the notice up until they answer or swipe it. */
  ring?: boolean;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export class PushService {
  private account: ServiceAccount | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor() {
    this.refresh();
  }

  /** Reconfigure on secret change — called by /api/secrets PUT. */
  refresh(): void {
    this.account = null;
    this.accessToken = null;
    this.tokenExpiresAt = 0;

    const raw = getSecret('fcm_service_account');
    if (!raw) {
      console.log('PushService: fcm_service_account not set — push disabled.');
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
      if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
        console.warn('PushService: fcm_service_account is missing project_id / client_email / private_key.');
        return;
      }
      this.account = parsed as ServiceAccount;
      console.log(`PushService: FCM configured for project ${this.account.project_id}.`);
    } catch {
      console.warn('PushService: fcm_service_account is not valid JSON — push disabled.');
    }
  }

  isConfigured(): boolean {
    return this.account !== null;
  }

  /**
   * Web push, for people running the house in a browser instead of the APK
   * (theirs, Oct 29 2026: both options in the kit). The VAPID pair is made the
   * first time a browser asks for it and kept in the secrets store, so it
   * never changes under a device that already subscribed. Nothing here caches
   * the app or touches a fetch: the service worker that receives these only
   * shows a notification and opens the right thread on a tap (push-sw.js).
   */
  getVapidPublicKey(): string | null {
    return this.vapidKeys()?.publicKey ?? null;
  }

  private vapidKeys(): { publicKey: string; privateKey: string } | null {
    try {
      let publicKey = getSecret('vapid_public_key');
      let privateKey = getSecret('vapid_private_key');
      if (!publicKey || !privateKey) {
        const made = webpush.generateVAPIDKeys();
        setSecret('vapid_public_key', made.publicKey);
        setSecret('vapid_private_key', made.privateKey);
        publicKey = made.publicKey;
        privateKey = made.privateKey;
        console.log('PushService: made a VAPID key pair for web push.');
      }
      return { publicKey, privateKey };
    } catch (err) {
      console.warn('PushService: no VAPID keys for web push:', err);
      return null;
    }
  }

  /** Web push to every browser that turned it on; answers how many took it. */
  private async sendWebPush(payload: PushPayload): Promise<number> {
    const subs = listPushSubscriptions().filter(s => s.type === 'web_push' && s.endpoint && s.keys_p256dh && s.keys_auth);
    if (subs.length === 0) return 0;
    const keys = this.vapidKeys();
    if (!keys) return 0;
    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      ...(payload.threadId ? { threadId: payload.threadId } : {}),
      ...(payload.tag ? { tag: payload.tag } : {}),
      ...(payload.url ? { url: payload.url } : {}),
      ...(payload.ring ? { ring: true } : {}),
    });
    let taken = 0;
    await Promise.all(subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint!, keys: { p256dh: sub.keys_p256dh!, auth: sub.keys_auth! } },
          body,
          { vapidDetails: { subject: 'mailto:aerie@localhost', publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: payload.ttl ?? 3600 },
        );
        touchPushSubscriptionById(sub.id);
        taken++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // Gone for good: the browser dropped this subscription.
        if (status === 404 || status === 410) {
          removePushSubscription(sub.endpoint!);
          console.log(`PushService: dropped a web push subscription the browser no longer has (${sub.id}).`);
          return;
        }
        console.error(`PushService: web push failed (${status ?? 'no status'}):`, (err as Error).message?.slice(0, 200));
      }
    }));
    return taken;
  }

  /** Sign a service-account JWT and trade it for a short-lived access token.
   * Cached until a minute before expiry so a burst of pushes signs once. */
  private async getAccessToken(): Promise<string | null> {
    if (!this.account) return null;
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(JSON.stringify({
      iss: this.account.client_email,
      scope: FCM_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: nowSec,
      exp: nowSec + 3600,
    }));

    let assertion: string;
    try {
      const signer = createSign('RSA-SHA256');
      signer.update(`${header}.${claims}`);
      signer.end();
      const signature = base64url(signer.sign(this.account.private_key));
      assertion = `${header}.${claims}.${signature}`;
    } catch (err) {
      console.error('PushService: failed to sign service-account JWT:', err);
      return null;
    }

    try {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
      });
      if (!res.ok) {
        console.error(`PushService: token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
        return null;
      }
      const json = await res.json() as { access_token?: string; expires_in?: number };
      if (!json.access_token) {
        console.error('PushService: token exchange returned no access_token.');
        return null;
      }
      this.accessToken = json.access_token;
      this.tokenExpiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
      return this.accessToken;
    } catch (err) {
      console.error('PushService: token exchange error:', err);
      return null;
    }
  }

  /** Browsers only: a ring for a house run in a browser, where the phone's
   *  data-only ring has nobody to read it (theirs, Nov 9 2026). */
  async sendWebOnly(payload: PushPayload): Promise<number> {
    return this.sendWebPush(payload);
  }

  /** Deliver a notification to every registered device, phones and browsers. */
  async sendPush(payload: PushPayload): Promise<void> {
    await this.sendWebPush(payload);
    await this.sendToEveryDevice(token => ({
      token,
      notification: { title: payload.title, body: payload.body },
      // Data travels alongside so a tap can open the right room.
      data: {
        ...(payload.threadId ? { threadId: payload.threadId } : {}),
        ...(payload.url ? { url: payload.url } : {}),
      },
      android: {
        priority: 'HIGH',
        notification: {
          // Same tag replaces rather than stacks — a chunked reply arrives
          // as one notification that updates, not four buzzes.
          ...(payload.tag ? { tag: payload.tag } : {}),
          default_sound: true,
        },
      },
    }));
  }

  /**
   * A data-only message: nothing is shown on their phone, the app's own
   * messaging service reads `data` and acts on it (the Spotify wake). HIGH so
   * it arrives through Doze; a short ttl (as long as the Spotify wake waits)
   * so a phone that was off doesn't act on it an hour late. Answers how many
   * devices FCM took it for.
   */
  async sendData(data: Record<string, string>, ttlSeconds = 120): Promise<number> {
    return this.sendToEveryDevice(token => ({
      token,
      data,
      android: { priority: 'HIGH', ttl: `${ttlSeconds}s` },
    }));
  }

  /** One message per registered device; answers how many FCM accepted. */
  private async sendToEveryDevice(messageFor: (token: string) => Record<string, unknown>): Promise<number> {
    if (!this.account) return 0;

    const subs = listPushSubscriptions().filter(s => s.device_token);
    if (subs.length === 0) return 0;

    const accessToken = await this.getAccessToken();
    if (!accessToken) return 0;

    const endpoint = `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`;
    let taken = 0;

    await Promise.all(subs.map(async sub => {
      const message = messageFor(sub.device_token!);

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message }),
        });

        if (res.ok) {
          touchPushSubscriptionById(sub.id);
          taken++;
          return;
        }

        const text = await res.text();
        // A token that the device has replaced or that belongs to an
        // uninstalled app is gone for good — drop it rather than retrying
        // it on every future push.
        if (res.status === 404 || (res.status === 400 && text.includes('UNREGISTERED'))) {
          removePushSubscriptionByToken(sub.device_token!);
          console.log(`PushService: dropped dead device token ${sub.id}.`);
          return;
        }
        console.error(`PushService: send failed (${res.status}): ${text.slice(0, 200)}`);
      } catch (err) {
        console.error('PushService: send error:', err);
      }
    }));
    return taken;
  }

  async sendIfOffline(payload: PushPayload): Promise<void> {
    if (!registry.isUserTabVisible()) {
      await this.sendPush(payload);
    }
  }

  async sendAlways(payload: PushPayload): Promise<void> {
    await this.sendPush(payload);
  }
}

// Module-level handle so code that isn't holding an Express request or the
// agent instance (the reply path, for one) can still reach the live service.
let activePushService: PushService | null = null;

export function setPushService(service: PushService): void {
  activePushService = service;
}

export function getPushService(): PushService | null {
  return activePushService;
}
