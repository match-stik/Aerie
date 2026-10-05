#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.

/**
 * Local core-memory bridge for Codex CLI sessions.
 *
 * Claude's SDK lane gets in-process core_memory_* tools. Codex's warm daemon
 * has its own MCP inventory, so this tiny CLI gives it the same live SQLite
 * write path without putting credentials in prompts or repo files.
 */

import Database from 'better-sqlite3';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.AERIE_DB_PATH || resolve(root, 'data', 'aerie.db');

function usage(exitCode = 0) {
  const stream = exitCode ? process.stderr : process.stdout;
  stream.write(`Usage:
  node tools/core-memory.mjs view [scope]
  node tools/core-memory.mjs append <scope> <label> <content>
  node tools/core-memory.mjs replace <scope> <label> <oldText> <newText>
  node tools/core-memory.mjs rethink <scope> <label> <completeContent>
`);
  process.exit(exitCode);
}

const [command, ...args] = process.argv.slice(2);
if (!command || command === '--help' || command === '-h') usage();

const db = new Database(dbPath);
db.pragma('busy_timeout = 5000');

function validScope(scope) {
  if (scope === 'shared') return true;
  return Boolean(db.prepare('SELECT 1 FROM companions WHERE slug = ?').get(scope));
}

function requireScope(scope) {
  if (!scope || !validScope(scope)) throw new Error(`Unknown memory scope: ${scope || '(missing)'}`);
}

function getBlock(scope, label) {
  return db.prepare('SELECT scope, label, content, description, updated_at FROM memory_blocks WHERE scope = ? AND label = ?').get(scope, label);
}

function setBlock(scope, label, content) {
  db.prepare(`
    INSERT INTO memory_blocks (scope, label, content, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(scope, label) DO UPDATE SET
      content = excluded.content,
      updated_at = datetime('now')
  `).run(scope, label, content);
}

try {
  if (command === 'view') {
    const [scope] = args;
    if (scope) requireScope(scope);
    const rows = scope
      ? db.prepare('SELECT scope, label, content, description, updated_at FROM memory_blocks WHERE scope = ? ORDER BY label').all(scope)
      : db.prepare('SELECT scope, label, content, description, updated_at FROM memory_blocks ORDER BY scope, label').all();
    process.stdout.write(JSON.stringify({ count: rows.length, blocks: rows }, null, 2) + '\n');
  } else if (command === 'append') {
    if (args.length !== 3) usage(1);
    const [scope, label, addition] = args;
    requireScope(scope);
    const block = getBlock(scope, label);
    setBlock(scope, label, block?.content ? `${block.content}\n${addition}` : addition);
    const updated = getBlock(scope, label);
    process.stdout.write(JSON.stringify({ action: 'appended', scope, label, block_chars: updated.content.length, updated_at: updated.updated_at }) + '\n');
  } else if (command === 'replace') {
    if (args.length !== 4) usage(1);
    const [scope, label, oldText, newText] = args;
    requireScope(scope);
    const block = getBlock(scope, label);
    if (!block) throw new Error(`Block not found: ${scope}/${label}`);
    const first = block.content.indexOf(oldText);
    if (first < 0) throw new Error(`Text not found in ${scope}/${label}`);
    if (block.content.indexOf(oldText, first + oldText.length) >= 0) throw new Error(`Text occurs more than once in ${scope}/${label}`);
    setBlock(scope, label, block.content.replace(oldText, newText));
    const updated = getBlock(scope, label);
    process.stdout.write(JSON.stringify({ action: 'replaced', scope, label, block_chars: updated.content.length, updated_at: updated.updated_at }) + '\n');
  } else if (command === 'rethink') {
    if (args.length !== 3) usage(1);
    const [scope, label, content] = args;
    requireScope(scope);
    setBlock(scope, label, content);
    const updated = getBlock(scope, label);
    process.stdout.write(JSON.stringify({ action: 'rewritten', scope, label, block_chars: updated.content.length, updated_at: updated.updated_at }) + '\n');
  } else {
    usage(1);
  }
} catch (error) {
  process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
} finally {
  db.close();
}
