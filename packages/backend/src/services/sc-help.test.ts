// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// ASKING A CLI FOR HELP MUST NOT BE MISTAKEN FOR CONTENT.
//
// Rose and Sol, Sep 17 2026: in their tree `sc treehouse --help` posted the
// literal words "--help" onto the treehouse wall, because that command takes
// its first argument as the text to post. We have no treehouse command — but
// the shape is here, in every command whose first argument is free text or a
// path, so the guard sits above the switch rather than inside one case.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sc = fileURLToPath(new URL('../../../../tools/sc.mjs', import.meta.url));
const run = (args: string[]) => execFileSync(process.execPath, [sc, ...args], { encoding: 'utf8', timeout: 10000 });

test('a bare invocation explains itself instead of doing anything', () => {
  assert.match(run([]), /Aerie internal API CLI/);
});

test('--help on a COMMAND never reaches the command', () => {
  // The whole finding: this must not touch the network or post anything.
  for (const flag of ['--help', '-h', 'help']) {
    const out = run(['notes', flag]);
    assert.match(out, /Aerie internal API CLI/, `sc notes ${flag}`);
  }
});

test('the command list names every command the file actually has', () => {
  const out = run(['--help']);
  for (const cmd of ['share', 'canvas', 'voice', 'schedule', 'timer', 'react', 'impulse', 'watch', 'tg', 'search', 'backfill', 'notes', 'sticker']) {
    assert.match(out, new RegExp(`\\b${cmd}\\b`), `${cmd} is missing from the help`);
  }
});
