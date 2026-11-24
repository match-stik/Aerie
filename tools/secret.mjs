#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Read one stored key for a script. The house keeps its keys sealed at rest
// (services/secret-box.ts), so a script that reads the config table straight
// gets ciphertext; this opens it with the key file and prints the value.
//
//   node tools/secret.mjs <name>          e.g. node tools/secret.mjs github_token
//
// Prints nothing and exits 1 when the key is not set or cannot be opened.
// Run it from a built house (npm run build in packages/backend). The value
// goes to stdout only, so read it into a variable rather than echoing it.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const name = process.argv[2];
if (!name) {
  console.error('Usage: node tools/secret.mjs <name>');
  process.exit(2);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lib = join(root, 'packages', 'backend', 'dist', 'services', 'secret-box.js');
if (!existsSync(lib)) {
  console.error('Build the backend first (npm run build in packages/backend).');
  process.exit(2);
}
const { loadSecretsKey, openValue } = await import(lib);
const Database = createRequire(join(root, 'packages', 'backend', 'package.json'))('better-sqlite3');
const db = new Database(process.env.AERIE_DB_PATH || join(root, 'data', 'aerie.db'), { readonly: true, fileMustExist: true });
const row = db.prepare('SELECT value FROM config WHERE key = ?').get(`secret:${name}`);
db.close();
const value = row ? openValue(String(row.value), loadSecretsKey(), `secret:${name}`) : null;
if (!value) process.exit(1);
process.stdout.write(value);
