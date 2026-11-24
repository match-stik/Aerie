// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// App shell update lane — the house builds and serves its own APK.
// The shell is a thin frame around the served phone app, so UI changes ship
// with every vite build; these routes only matter when the native layer
// itself changes (new plugins, new permissions). Artifacts live in data/app/
// (gitignored): aerie.apk + version.json, staged by the Android build.

import { Router } from 'express';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { authMiddleware } from '../middleware/auth.js';
import { PROJECT_ROOT } from '../config.js'; // npm start runs from packages/backend; the repo root is where data/ and tools/ live

const APP_DIR = join(PROJECT_ROOT, 'data', 'app');

const router = Router();
router.use(authMiddleware);

router.get('/version', (_req, res) => {
  const versionPath = join(APP_DIR, 'version.json');
  if (!existsSync(versionPath)) {
    return res.json({ available: false });
  }
  try {
    const meta = JSON.parse(readFileSync(versionPath, 'utf-8'));
    res.json({ available: existsSync(join(APP_DIR, 'aerie.apk')), ...meta });
  } catch {
    res.json({ available: false });
  }
});

router.get('/download', (_req, res) => {
  const apkPath = join(APP_DIR, 'aerie.apk');
  if (!existsSync(apkPath)) {
    return res.status(404).json({ error: 'No APK staged' });
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="aerie.apk"');
  res.sendFile(apkPath);
});

// The Aerie app on their laptop (desktop/, theirs Nov 15 2026): its zip lives in
// data/app/desktop/ beside a version.json (desktop/stage.mjs writes both),
// and the app's Settings button reads one and fetches the other.
const DESKTOP_DIR = join(APP_DIR, 'desktop');

interface DesktopMeta { version: string; file: string; sha256?: string; signature?: string }

/** version.json as stage.mjs wrote it; the hash and signature only when well formed. */
export function parseDesktopMeta(raw: unknown): DesktopMeta | null {
  const meta = (raw && typeof raw === 'object' ? raw : {}) as { version?: unknown; file?: unknown; sha256?: unknown; signature?: unknown };
  if (typeof meta.version !== 'string' || typeof meta.file !== 'string' || !/^[\w.\- ]+\.zip$/.test(meta.file)) return null;
  const out: DesktopMeta = { version: meta.version, file: meta.file };
  if (typeof meta.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(meta.sha256)
    && typeof meta.signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(meta.signature)) {
    out.sha256 = meta.sha256.toLowerCase();
    out.signature = meta.signature;
  }
  return out;
}

function desktopMeta(): DesktopMeta | null {
  try {
    const meta = parseDesktopMeta(JSON.parse(readFileSync(join(DESKTOP_DIR, 'version.json'), 'utf-8')));
    return meta && existsSync(join(DESKTOP_DIR, meta.file)) ? meta : null;
  } catch {
    return null;
  }
}

// The hash and signature go to the app with the version, so it can check the
// zip it downloads against the key it was built with (desktop/update-signature.cjs).
router.get('/desktop/version', (_req, res) => {
  const meta = desktopMeta();
  res.json(meta
    ? { available: true, version: meta.version, ...(meta.signature ? { sha256: meta.sha256, signature: meta.signature } : {}) }
    : { available: false });
});

router.get('/desktop/download', (_req, res) => {
  const meta = desktopMeta();
  if (!meta) return res.status(404).json({ error: 'No laptop app staged' });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${meta.file}"`);
  res.sendFile(join(DESKTOP_DIR, meta.file));
});

/**
 * A sideloaded APK has no crash console anywhere. Without this the only report
 * of a native crash is their person describing an app that vanished, so the shell
 * posts its own stack on the way out and it lands here as evidence.
 */
router.post('/crash', (req, res) => {
  const report = typeof req.body?.report === 'string' ? req.body.report : null;
  if (!report) return res.status(400).json({ error: 'No report' });
  try {
    if (!existsSync(APP_DIR)) mkdirSync(APP_DIR, { recursive: true });
    // Bounded, because a crash loop must not be able to fill the disk.
    const entry = `\n=== ${new Date().toISOString()} ===\n${report.slice(0, 20000)}\n`;
    appendFileSync(join(APP_DIR, 'crashes.log'), entry);
  } catch {
    // A failure to record a crash is not worth a second error path; the
    // shell has already written its own copy on the device.
  }
  res.json({ received: true });
});

export default router;
