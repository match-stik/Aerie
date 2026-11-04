// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import crypto from 'crypto';
import { addPushSubscription, addFcmSubscription, removePushSubscription, listPushSubscriptions } from '../../services/db.js';
import { getAerieConfig } from '../../config.js';

import type { PushService } from '../../services/push.js';

const router = Router();

// --- Push subscription endpoints ---

// Subscribe to push notifications
router.post('/push/subscribe', (req, res) => {
  try {
    const { endpoint, keys, deviceLabel, deviceToken } = req.body;

    // APK path: @capacitor/push-notifications hands us an FCM device token and
    // nothing else. The web-push shape below is kept for the old PWA path.
    if (deviceToken) {
      const id = crypto.randomUUID();
      addFcmSubscription({ id, deviceToken, deviceName: deviceLabel });
      res.json({ success: true, id, transport: 'fcm' });
      return;
    }

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      res.status(400).json({ error: 'deviceToken, or endpoint and keys (p256dh, auth), required' });
      return;
    }

    const id = crypto.randomUUID();
    addPushSubscription({
      id,
      endpoint,
      keysP256dh: keys.p256dh,
      keysAuth: keys.auth,
      deviceName: deviceLabel,
    });

    res.json({ success: true, id });
  } catch (error) {
    console.error('Error subscribing to push:', error);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// Unsubscribe from push notifications
router.post('/push/unsubscribe', (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      res.status(400).json({ error: 'endpoint required' });
      return;
    }

    const removed = removePushSubscription(endpoint);
    res.json({ success: true, removed });
  } catch (error) {
    console.error('Error unsubscribing from push:', error);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// List push subscriptions (truncated endpoints for display)
router.get('/push/subscriptions', (req, res) => {
  try {
    const subs = listPushSubscriptions();
    const display = subs.map(s => ({
      id: s.id,
      deviceName: s.device_name,
      endpoint: s.endpoint ? s.endpoint.slice(0, 60) + '...' : null,
      createdAt: s.created_at,
      lastUsedAt: s.last_used_at,
    }));
    res.json({ subscriptions: display });
  } catch (error) {
    console.error('Error listing push subscriptions:', error);
    res.status(500).json({ error: 'Failed to list subscriptions' });
  }
});

// Send test push notification
router.post('/push/test', async (req, res) => {
  try {
    const pushService = req.app.locals.pushService as PushService | undefined;
    const hasWebPush = listPushSubscriptions().some(s => s.type === 'web_push');
    if (!pushService || (!pushService.isConfigured() && !hasWebPush)) {
      res.status(503).json({ error: 'Push not configured — turn on notifications in this browser (Settings), or add the Firebase service-account JSON as fcm_service_account in Settings → Keys for the Android app.' });
      return;
    }

    const config = getAerieConfig();
    await pushService.sendPush({
      title: config.identity.companion_name,
      body: 'Push notifications are working!',
      tag: 'test',
      url: '/chat',
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error sending test push:', error);
    res.status(500).json({ error: 'Failed to send test push' });
  }
});

export default router;
