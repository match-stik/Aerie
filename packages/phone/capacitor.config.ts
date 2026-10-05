// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { CapacitorConfig } from '@capacitor/cli';
import { readFileSync } from 'fs';
import { join } from 'path';

// Thin-shell mode: the APK is a native frame around the served phone app,
// so UI updates ship with every vite build — the shell only rebuilds when
// native capabilities change.
//
// The served URL is deployment-specific and lives in the gitignored
// server-url.local (see server-url.local.example). It must be HTTPS:
// the WebView refuses getUserMedia (voice mic) from a cleartext origin.
// With no file present the shell falls back to bundled assets.
let serverUrl: string | undefined;
try {
  serverUrl = readFileSync(join(process.cwd(), 'server-url.local'), 'utf-8').trim() || undefined;
} catch {
  serverUrl = undefined;
}

const config: CapacitorConfig = {
  appId: 'com.aerie.phone',
  appName: 'Aerie',
  webDir: 'dist',
  ...(serverUrl ? { server: { url: serverUrl } } : {}),
};

export default config;
