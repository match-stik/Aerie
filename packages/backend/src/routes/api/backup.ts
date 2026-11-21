// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The sealed backup's doors (services/sealed-backup.ts). Behind the login.
// The laptop app hands the house a public key once (the phrase stays on the
// laptop), then fetches the newest sealed copy whenever it is open. The house
// keeps only the newest two itself, in data/backups/sealed.

import { Router } from 'express';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import * as cron from 'node-cron';
import { getConfig, setConfig } from '../../services/db/config.js';
import { getDb } from '../../services/db/init.js';
import { listSealedBackups, makeSealedBackup } from '../../services/sealed-backup.js';
import { PROJECT_ROOT } from '../internal/local.js';

const router = Router();
export const SEALED_DIR = join(PROJECT_ROOT, 'data', 'backups', 'sealed');

function publicKey(): Buffer | null {
  const raw = getConfig('backup.public_key');
  if (!raw) return null;
  const b = Buffer.from(raw, 'base64');
  return b.length === 32 ? b : null;
}

let running: Promise<unknown> | null = null;
let lastError: string | null = null;

/** Make one sealed backup now, unless one is already being made. */
export async function runSealedBackup(): Promise<{ ok: boolean; error?: string }> {
  const key = publicKey();
  if (!key) return { ok: false, error: 'No backup key yet. Set it up from the laptop app.' };
  if (running) { await running; return { ok: true }; }
  running = makeSealedBackup({ db: getDb(), publicKeyRaw: key, dir: SEALED_DIR, keep: 2 })
    .then((r) => { lastError = null; console.log(`[Backup] sealed ${r.bytes} bytes`); })
    .catch((e) => { lastError = e instanceof Error ? e.message : String(e); console.error('[Backup] failed:', lastError); });
  try { await running; } finally { running = null; }
  return lastError ? { ok: false, error: lastError } : { ok: true };
}

/** Once a night, at 4:20 in the house's own timezone, when a key is set. */
export function scheduleSealedBackups(timezone: string): void {
  cron.schedule('20 4 * * *', () => { if (publicKey()) void runSealedBackup(); }, { timezone });
}

router.get('/backup/status', (_req, res) => {
  const list = listSealedBackups(SEALED_DIR);
  res.json({ configured: Boolean(publicKey()), latest: list[0] ?? null, count: list.length, lastError, running: Boolean(running) });
});

// The public half only: 32 bytes, base64. A new key means new backups open
// with the new phrase; ones already made still need the phrase they were made for.
router.post('/backup/key', (req, res) => {
  const raw = typeof req.body?.publicKey === 'string' ? Buffer.from(req.body.publicKey, 'base64') : null;
  if (!raw || raw.length !== 32) return res.status(400).json({ error: 'publicKey is 32 bytes, base64.' });
  setConfig('backup.public_key', raw.toString('base64'));
  res.json({ ok: true });
});

router.post('/backup/now', async (_req, res) => {
  const r = await runSealedBackup();
  res.status(r.ok ? 200 : 400).json({ ...r, latest: listSealedBackups(SEALED_DIR)[0] ?? null });
});

router.get('/backup/latest', (_req, res) => {
  const latest = listSealedBackups(SEALED_DIR)[0];
  if (!latest) return res.status(404).json({ error: 'No sealed backup yet.' });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${latest.name}"`);
  res.setHeader('Content-Length', String(latest.bytes));
  createReadStream(join(SEALED_DIR, latest.name)).pipe(res);
});

export default router;
