#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.

/**
 * Give the guests already in the history their name and their face back.
 *
 * A bridged message carries whatever the gateway happened to record the day it
 * arrived. Both of those fields were added later than the bridge itself, so
 * older rows are missing them: a visitor renders under their raw handle, or as
 * a letter in a circle, while the same person two messages further down reads
 * correctly. Nothing is broken — the rows simply predate us asking.
 *
 * TWO SOURCES, AND THE ORDER MATTERS.
 *
 * For a NAME, the owner's own history wins. If a user id already appears somewhere
 * with a display name, that is what the owner has been reading them as, and the old
 * rows should join it rather than introduce a third spelling. Discord is only
 * consulted for someone who has never once been recorded with a name.
 *
 * For a FACE there is no local source, so Discord is the only witness. That
 * makes it the CURRENT picture rather than the one they wore at the time —
 * true of every avatar everywhere, and worth knowing rather than hiding.
 *
 * Reversible: every touched row's original metadata is written out first.
 *
 *   node tools/backfill-discord-identity.mjs --dry-run
 *   node tools/backfill-discord-identity.mjs
 *
 * Needs the bot token, read from the same secrets store the gateway uses.
 */

import Database from 'better-sqlite3';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.AERIE_DB_PATH || resolve(root, 'data', 'aerie.db');
const dryRun = process.argv.includes('--dry-run');

const db = new Database(dbPath);
db.pragma('busy_timeout = 20000');

const tokenRow = db
  .prepare("SELECT value FROM config WHERE key = 'secret:discord_bot_token'")
  .get();
const token = tokenRow
  ? (String(tokenRow.value).startsWith('"') ? JSON.parse(tokenRow.value) : tokenRow.value)
  : process.env.DISCORD_BOT_TOKEN;

/** Guest rows only. The owner's own bridged messages are stored as 'user' and already
 *  render as the owner, so they are none of this script's business. */
const GUESTS = `
  SELECT id, metadata, created_at
  FROM messages
  WHERE platform = 'discord' AND role = 'system' AND deleted_at IS NULL
    AND json_extract(metadata, '$.discordUserId') IS NOT NULL
  ORDER BY sequence
`;

const rows = db.prepare(GUESTS).all().map(r => ({ ...r, meta: JSON.parse(r.metadata) }));
if (rows.length === 0) {
  console.log('No bridged guest messages here — nothing to do.');
  process.exit(0);
}

// The name each guest was most recently seen under, from the owner's own history.
const knownName = new Map();
for (const r of rows) {
  const uid = String(r.meta.discordUserId);
  if (r.meta.discordDisplayName) knownName.set(uid, r.meta.discordDisplayName);
}

const ids = [...new Set(rows.map(r => String(r.meta.discordUserId)))];
const needsName = ids.filter(id => !knownName.has(id));
const needsFace = ids.filter(id =>
  rows.some(r => String(r.meta.discordUserId) === id && !r.meta.discordAvatarUrl));

console.log(`${rows.length} guest messages, ${ids.length} people.`);
console.log(`  never recorded with a name: ${needsName.length}`);
console.log(`  missing a picture somewhere: ${needsFace.length}`);

/** Discord's own default avatar for someone who has never set one. */
const defaultAvatar = uid =>
  `https://cdn.discordapp.com/embed/avatars/${(BigInt(uid) >> 22n) % 6n}.png`;

async function fetchUser(uid) {
  const res = await fetch(`https://discord.com/api/v10/users/${uid}`, {
    headers: { Authorization: `Bot ${token}`, 'User-Agent': 'Aerie (aerie, 1.0)' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const u = await res.json();
  return {
    name: u.global_name || u.username,
    avatar: u.avatar
      ? `https://cdn.discordapp.com/avatars/${uid}/${u.avatar}.${u.avatar.startsWith('a_') ? 'gif' : 'png'}?size=128`
      : defaultAvatar(uid),
  };
}

const live = new Map();
const wanted = [...new Set([...needsName, ...needsFace])];
if (wanted.length && !token) {
  console.error('No Discord bot token available — cannot ask for faces. Names from history still apply.');
}
for (const uid of wanted) {
  if (!token) break;
  try {
    live.set(uid, await fetchUser(uid));
  } catch (err) {
    // One unreachable account must not cost everybody else their face.
    console.error(`  ${uid}: ${err.message} — left as it was`);
  }
  await new Promise(r => setTimeout(r, 400));
}

const undo = [];
const updates = [];
for (const r of rows) {
  const uid = String(r.meta.discordUserId);
  const meta = { ...r.meta };
  let touched = false;

  if (!meta.discordDisplayName) {
    const name = knownName.get(uid) || live.get(uid)?.name;
    if (name) { meta.discordDisplayName = name; touched = true; }
  }
  if (!meta.discordAvatarUrl && live.get(uid)?.avatar) {
    meta.discordAvatarUrl = live.get(uid).avatar;
    touched = true;
  }
  if (!touched) continue;

  undo.push({ id: r.id, metadata: r.metadata });
  updates.push({ id: r.id, metadata: JSON.stringify(meta) });
}

if (updates.length === 0) {
  console.log('Every guest already has their name and their face. Nothing to change.');
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 10);
const undoPath = resolve(root, 'data', `discord-identity-backfill-${stamp}.json`);

if (dryRun) {
  console.log(`\nWould touch ${updates.length} rows. Nothing written (--dry-run).`);
  for (const uid of ids) {
    const n = knownName.get(uid) || live.get(uid)?.name || '(unknown)';
    const c = updates.filter(u => rows.find(r => r.id === u.id && String(r.meta.discordUserId) === uid)).length;
    if (c) console.log(`  ${n}: ${c}`);
  }
  process.exit(0);
}

writeFileSync(undoPath, JSON.stringify(undo, null, 1));
const stmt = db.prepare('UPDATE messages SET metadata = ? WHERE id = ?');
db.transaction(list => { for (const u of list) stmt.run(u.metadata, u.id); })(updates);

console.log(`\nBackfilled ${updates.length} rows.`);
console.log(`Undo list: ${undoPath}`);
