// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// BYOK secrets API — list (masked), set, clear. Each PUT/DELETE fires
// a small re-init for the affected service so changes take effect
// without a server restart.

import { Router, type Request } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { deleteSecret, getSecret, listSecrets, listSecretsByPrefix, setSecret } from '../services/secrets.js';
import { listCompanions } from '../services/db/companions.js';

const router = Router();
router.use(authMiddleware);

// Which secrets the browser may read the RAW VALUE of. The phone talks to a few
// third parties directly (ElevenLabs for voice, Giphy) and shows a couple of its
// own service values (the Cortex URL and token, with a reveal-and-copy). Every
// other secret — the Discord and Telegram bot tokens, the FCM service account,
// the GitHub and Cloudflare tokens, the model provider keys — is write-only from
// a client: it can be set or cleared but never read back. This caps the damage a
// stolen or valid session cookie can do from "vacuum every key" to these few.
// (The masked LIST at GET /secrets shows all names without values, and PUT/DELETE
// on any name still work — this gate is only on reading a raw value.)
const REVEALABLE_SECRETS = new Set([
  'elevenlabs_api_key',
  'giphy_api_key',
  'cortex_mcp_url',
  'cortex_auth_token',
]);
export function isRevealableSecret(name: string): boolean {
  return REVEALABLE_SECRETS.has(name) || name.startsWith('elevenlabs_voice_id:');
}

router.get('/secrets', (_req, res) => {
  let slugs: string[] = [];
  try {
    slugs = listCompanions().map((c) => c.slug);
  } catch {
    /* companions table may be empty */
  }
  res.json({ secrets: listSecrets(slugs) });
});

// Reveal a single secret's actual value (the user is authenticated, so
// this is no more sensitive than the cookie itself). Used by the phone
// runtime that talks to ElevenLabs / Giphy directly from the browser.
router.get('/secrets/:name', (req: Request, res) => {
  const name = String(req.params.name);
  if (!isRevealableSecret(name)) {
    // Write-only from a client. Do not leak whether it is set, either.
    return res.status(403).json({ error: 'not revealable' });
  }
  const value = getSecret(name);
  if (!value) {
    return res.status(404).json({ error: 'not set' });
  }
  res.json({ name, value });
});

router.put('/secrets/:name', async (req: Request, res) => {
  const name = String(req.params.name);
  const value = typeof req.body?.value === 'string' ? req.body.value.trim() : '';
  if (!value) {
    return res.status(400).json({ error: 'value is required — use DELETE to clear' });
  }
  setSecret(name, value);
  await reinitFor(req, name);
  res.json({ ok: true, name, hasValue: true });
});

router.delete('/secrets/:name', async (req: Request, res) => {
  const name = String(req.params.name);
  deleteSecret(name);
  await reinitFor(req, name);
  res.json({ ok: true, name });
});

// List every `elevenlabs_voice_id:*` secret currently in the DB along
// with whether a companion is registered under that slug. Lets the
// phone show orphan rows (a voice ID whose companion was never created
// or got renamed) and offer to clean them up.
router.get('/secrets/voice-ids/all', (_req, res) => {
  let slugs = new Set<string>();
  try {
    slugs = new Set(listCompanions().map((c) => c.slug.toLowerCase()));
  } catch { /* companions table may be empty */ }
  const all = listSecretsByPrefix('elevenlabs_voice_id:');
  const rows = Object.keys(all).map((key) => {
    const slug = key.slice('elevenlabs_voice_id:'.length);
    return { name: key, slug, registered: slugs.has(slug.toLowerCase()), hasValue: !!all[key] };
  });
  res.json({ rows });
});

// Re-initialize the right service when a secret changes. Voice & Push
// expose refresh() so they can pick up new values without restarting;
// Discord & Telegram cycle their gateways since the token is read at
// connect time.
async function reinitFor(req: Request, name: string): Promise<void> {
  const app = req.app;
  try {
    if (name === 'discord_bot_token') {
      const svc = app.locals.discordService as { stop: () => Promise<void>; start: () => Promise<void> } | undefined;
      if (svc) {
        await svc.stop();
        await svc.start();
      }
    } else if (name === 'telegram_bot_token' || name === 'giphy_api_key') {
      const svc = app.locals.telegramService as { stop: () => Promise<void>; start: () => Promise<void> } | undefined;
      if (svc) {
        await svc.stop();
        await svc.start();
      }
    } else if (name.startsWith('elevenlabs_') || name === 'hume_api_key' || name === 'groq_api_key') {
      const svc = app.locals.voiceService as { refresh?: () => void } | undefined;
      svc?.refresh?.();
    } else if (name.startsWith('vapid_')) {
      const svc = app.locals.pushService as { refresh?: () => void } | undefined;
      svc?.refresh?.();
    }
  } catch (err) {
    console.error('[Secrets] Re-init failed for %s:', name, err);
  }
}

export default router;
