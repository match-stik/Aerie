#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Bridges Aerie's Codex OAuth (data/codex-auth.json, owned + refreshed by the
// backend) into Codex CLI's auth via `codex login --with-access-token`.
// Access token only — the refresh token stays with Aerie so two refreshers
// never race over rotation ("refresh token already used").
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const authPath = process.env.CODEX_AUTH_PATH || resolve(root, 'data', 'codex-auth.json');

let creds;
try {
  creds = JSON.parse(readFileSync(authPath, 'utf8'));
} catch {
  console.error(`No Aerie Codex auth at ${authPath} — log in via Settings → Provider Health first.`);
  process.exit(1);
}

if (typeof creds.access !== 'string' || !creds.access) {
  console.error('Aerie Codex auth file has no access token — re-login via Settings → Provider Health.');
  process.exit(1);
}

const expires = creds.expires > 1e12 ? creds.expires : creds.expires * 1000;
const daysLeft = (expires - Date.now()) / 86_400_000;
if (daysLeft <= 0) {
  console.error(
    'Aerie Codex access token is expired. Use a Codex model once (or re-login in ' +
    'Settings → Provider Health) so the backend refreshes it, then re-run this bridge.',
  );
  process.exit(1);
}

// Write ~/.codex/auth.json directly. The access JWT carries the same
// auth/profile claims the CLI reads from an id_token, so it serves as both.
// refresh_token stays empty on purpose: Aerie is the single refresh authority.
const codexHome = process.env.CODEX_HOME || resolve(homedir(), '.codex');
mkdirSync(codexHome, { recursive: true });
const outPath = resolve(codexHome, 'auth.json');
writeFileSync(
  outPath,
  JSON.stringify(
    {
      OPENAI_API_KEY: null,
      tokens: {
        id_token: creds.access,
        access_token: creds.access,
        refresh_token: '',
        account_id: creds.accountId ?? null,
      },
      last_refresh: new Date().toISOString(),
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(`Wrote ${outPath} from Aerie's auth (token expires in ${daysLeft.toFixed(1)} days).`);
