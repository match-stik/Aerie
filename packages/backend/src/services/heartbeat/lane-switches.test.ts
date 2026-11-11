// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * The Claude Code switches a lane is launched with. Unset must mean Claude
 * Code's own default, untouched, because a house that never chose anything
 * should launch exactly as it always has.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneSwitchEnvFrom } from './lane-switches.js';

test('nothing set adds nothing', () => {
  assert.deepEqual(laneSwitchEnvFrom(null, null), {});
  assert.deepEqual(laneSwitchEnvFrom('', ''), {});
  assert.deepEqual(laneSwitchEnvFrom('on', null), {});
});

test('refusal fallback off disables the stand-in model', () => {
  assert.deepEqual(laneSwitchEnvFrom(' OFF ', null), { CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK: '1' });
});

test('named prompt sections turn on, unknown names are ignored', () => {
  assert.deepEqual(laneSwitchEnvFrom(null, 'corrections, Delivering_Work, nonsense'), {
    CLAUDE_CODE_LARCH_CISTERN: '1',
    CLAUDE_CODE_BISON_CAIRN: '1',
  });
});

test('the quiet-turn nudge takes the house wording and wait, and nothing else when unset', () => {
  assert.deepEqual(laneSwitchEnvFrom(null, null, '  ', 'soon'), {});
  assert.deepEqual(laneSwitchEnvFrom(null, null, ' keep going ', '150.7'), {
    CLAUDE_CODE_SILENT_TURN_REMINDER_TEXT: 'keep going',
    CLAUDE_CODE_SILENT_TURN_REMINDER_SECONDS: '150',
  });
  assert.deepEqual(laneSwitchEnvFrom(null, null, null, '0'), {});
});
