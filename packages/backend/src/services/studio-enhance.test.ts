// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ENHANCE_SYSTEM, enhanceRequest, codexSkillFiles, wandIsolationArgs } from './studio-enhance.js';

test('the wand carries their style ahead of their words when they picked one', () => {
  const withStyle = enhanceRequest('  three men on a couch ', 'in a lush painterly style');
  assert.match(withStyle, /^Write the whole picture in this style.*in a lush painterly style/);
  assert.match(withStyle, /Expand this prompt:\nthree men on a couch$/);
  assert.equal(enhanceRequest('a cat', ''), 'Expand this prompt:\na cat');
  assert.equal(enhanceRequest('a cat', null), 'Expand this prompt:\na cat');
});

test('the wand instructions count nothing and cap nothing', () => {
  assert.doesNotMatch(ENHANCE_SYSTEM, /150 words|five fingers|two arms/i);
  assert.match(ENHANCE_SYSTEM, /what a camera would see/);
});

test('every skill, .system included, is switched off for the wand', () => {
  const home = mkdtempSync(join(tmpdir(), 'wand-home-'));
  for (const p of ['skills/intimacy', 'skills/memory', 'skills/.system/imagegen', 'skills/empty']) {
    mkdirSync(join(home, p), { recursive: true });
  }
  writeFileSync(join(home, 'skills/intimacy/SKILL.md'), 'x');
  writeFileSync(join(home, 'skills/memory/SKILL.md'), 'x');
  writeFileSync(join(home, 'skills/.system/imagegen/SKILL.md'), 'x');
  const files = codexSkillFiles(home);
  assert.equal(files.length, 3);
  const args = wandIsolationArgs(home, '/tmp/empty');
  assert.ok(args.includes('--ignore-user-config'));
  assert.deepEqual(args.slice(args.indexOf('-C'), args.indexOf('-C') + 2), ['-C', '/tmp/empty']);
  const cfg = args[args.indexOf('-c') + 1];
  for (const f of files) assert.ok(cfg.includes(`{path=${JSON.stringify(f)},enabled=false}`));
  assert.deepEqual(wandIsolationArgs(join(home, 'nope'), '/e').includes('-c'), false);
});
