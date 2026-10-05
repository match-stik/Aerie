// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// App shell update lane — the house builds and serves its own APK.
// The shell is a thin frame around the served phone app, so UI changes ship
// with every vite build; these routes only matter when the native layer
// itself changes (new plugins, new permissions). Artifacts live in data/app/
// (gitignored): aerie.apk + version.json, staged by the Android build.

import { Router } from 'express';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { authMiddleware } from '../middleware/auth.js';

const APP_DIR = join(process.cwd(), 'data', 'app');

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

/**
 * A sideloaded APK has no crash console anywhere. Without this the only report
 * of a native crash is the owner describing an app that vanished, so the shell
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
