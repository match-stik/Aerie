// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
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
import { getSecret } from './secrets.js';
import {
  listPushSubscriptions,
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

  /** Legacy web-push subscribe path — always null now; the APK uses FCM. */
  getVapidPublicKey(): string | null {
    return null;
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

  /** Deliver a notification to every registered device. */
  async sendPush(payload: PushPayload): Promise<void> {
    if (!this.account) return;

    const subs = listPushSubscriptions().filter(s => s.device_token);
    if (subs.length === 0) return;

    const accessToken = await this.getAccessToken();
    if (!accessToken) return;

    const endpoint = `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`;

    await Promise.all(subs.map(async sub => {
      const message: Record<string, unknown> = {
        token: sub.device_token,
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
      };

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
