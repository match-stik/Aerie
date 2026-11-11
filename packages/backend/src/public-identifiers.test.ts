// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A public tree must not carry a real house's identifiers. This checks for
// KINDS of identifier rather than for anybody's private strings, so the check
// itself can ship: a tailnet host, a Bluetooth address, a Spotify playlist id
// or a Discord emoji id that is not one of the obvious fillers the tests use.
// Each of these got through a name-only scrub once.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function trackedFiles(): string[] | null {
  try {
    return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf-8' }).split('\n').filter(Boolean);
  } catch {
    return null; // not a git checkout (a downloaded archive): nothing to walk
  }
}

const BINARY = /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|otf|aar|jar|mp3|mp4|wav|ogg|zip|pdf|keystore)$/i;

const FAKE_PLAYLISTS = new Set(['7Lq3sR9vKm2Xw8YbN4pT1c', '5Hj8dQ2zFn6Rt1VcW9kA3e', '0123456789abcdefABCDEF']);
const FAKE_MACS = new Set(['AA:BB:CC:DD:EE:FF', '00:00:00:00:00:00', '00:11:22:33:44:55']);

/** A Discord id the tests made up: a counting run, a 1 followed by zeros, or one digit repeated. */
function looksFake(id: string): boolean {
  return /^\d?23456789/.test(id) || /^10+\d?$/.test(id) || /^(\d)\1+$/.test(id);
}

export function findPublicIdentifiers(file: string, text: string): string[] {
  const found: string[] = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const at = `${file}:${i + 1}`;
    for (const host of line.match(/\b[a-z0-9-]+\.[a-z0-9-]+\.ts\.net\b/gi) ?? []) {
      if (!/example|your-/i.test(host)) found.push(`${at} tailnet host ${host}`);
    }
    for (const mac of line.match(/\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/gi) ?? []) {
      if (!FAKE_MACS.has(mac.toUpperCase())) found.push(`${at} Bluetooth address ${mac}`);
    }
    for (const m of line.matchAll(/playlist[:/'"\s_=]+([A-Za-z0-9]{22})\b/g)) {
      if (!FAKE_PLAYLISTS.has(m[1])) found.push(`${at} Spotify playlist ${m[1]}`);
    }
    for (const m of line.matchAll(/<a?:[A-Za-z0-9_]+:(\d{17,20})>/g)) {
      if (!looksFake(m[1])) found.push(`${at} Discord emoji id ${m[1]}`);
    }
    // A Discord channel, server or user id written as one: by name or in a URL.
    for (const m of line.matchAll(/(?:channels\/|guilds?\/|users\/|(?:channel|guild|server|user|author)_?[iI]d['"]?\s*[:=]\s*['"]?)(\d{17,20})\b/g)) {
      if (!looksFake(m[1])) found.push(`${at} Discord id ${m[1]}`);
    }
    // A Cloudflare worker on somebody's own account subdomain (name.account.workers.dev).
    for (const host of line.match(/\b[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\b/gi) ?? []) {
      if (!/example|your-|account|<|\$\{/i.test(host)) found.push(`${at} worker host ${host}`);
    }
  });
  return found;
}

test('the checker catches each kind it looks for', () => {
  assert.equal(findPublicIdentifiers('x', 'host: home.tail12345.ts.net').length, 1);
  assert.equal(findPublicIdentifiers('x', 'id: 12:34:56:78:9A:BC').length, 1);
  assert.equal(findPublicIdentifiers('x', "uri: 'spotify:playlist:9Zz9zZ9zZ9zZ9zZ9zZ9zZ9'").length, 1);
  assert.equal(findPublicIdentifiers('x', 'Look <:heart:987654321098765432> here').length, 1);
  assert.equal(findPublicIdentifiers('x', 'https://discord.com/channels/987654321098765432/876543219876543210').length, 1);
  assert.equal(findPublicIdentifiers('x', "channelId: '876543219876543210'").length, 1);
  assert.equal(findPublicIdentifiers('x', 'url: https://my-worker.someone.workers.dev/mcp').length, 1);
  assert.deepEqual(findPublicIdentifiers('x', 'host aerie.example.ts.net, mac AA:BB:CC:DD:EE:FF, <:fire:123456789012345678>'), []);
  assert.deepEqual(findPublicIdentifiers('x', "channelId: '123456789012345678', https://my-worker.your-account.workers.dev"), []);
});

test('no tracked file carries a real house identifier', (t) => {
  const files = trackedFiles();
  if (!files) { t.skip('not a git checkout'); return; }
  const found: string[] = [];
  for (const file of files) {
    // This file's own samples are invented on purpose, to prove the checker bites.
    if (BINARY.test(file) || file.endsWith('package-lock.json') || file.endsWith('public-identifiers.test.ts')) continue;
    let text: string;
    try { text = readFileSync(join(ROOT, file), 'utf-8'); } catch { continue; }
    found.push(...findPublicIdentifiers(file, text));
  }
  assert.deepEqual(found, [], `real identifiers in tracked files:\n${found.join('\n')}`);
});
