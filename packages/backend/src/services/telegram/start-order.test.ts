// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Telegraf runs handlers in the order they were registered, and the catch-all
// text handler never calls next(). /start is a text message, so while the
// catch-all came first it swallowed /start and answered 'Send /start first',
// and the command that links the owner's chat could never run.
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf-8');

test('the /start command is registered before the catch-all text handler', () => {
  const start = source.indexOf("this.bot.command('start'");
  const text = source.indexOf("this.bot.on('text'");
  assert.ok(start >= 0, 'the /start command should exist');
  assert.ok(text >= 0, 'the text handler should exist');
  assert.ok(start < text, '/start must be registered before bot.on(\'text\')');
});
