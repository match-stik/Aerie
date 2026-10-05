// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlainName, escapeDrawtextValue, isDrawtextColor, isDrawtextSize } from './gif-safety.js';

test('a session or frame name has to be a plain name', () => {
  assert.equal(isPlainName('2f1c6a0e-8d1b-4a59-9b8e-0c2f4b6d8e10'), true);
  assert.equal(isPlainName('frame-0001.png'), true);
  assert.equal(isPlainName('original-frame-0001.png'), true);
  for (const bad of ['', '..', '../aerie.yaml', 'a/b', '/etc/passwd', 'a\\b', 'x\0y', 42, null, ['frame-0001.png']]) {
    assert.equal(isPlainName(bad), false, String(bad));
  }
});

test('a drawtext colour or size cannot open a filter option of its own', () => {
  for (const ok of ['white', '#ff8800', '0xff8800', 'black@0.5']) assert.equal(isDrawtextColor(ok), true, ok);
  for (const bad of ['white:textfile=/etc/passwd', "red'", 'a b', '', 7]) assert.equal(isDrawtextColor(bad), false, String(bad));
  assert.equal(isDrawtextSize(24), true);
  assert.equal(isDrawtextSize('24'), true);
  assert.equal(isDrawtextSize('24:x=0'), false);
  assert.equal(isDrawtextSize(0), false);
  assert.equal(isDrawtextSize(true), false);
});

test('a font name is escaped so it stays inside its quotes', () => {
  assert.equal(escapeDrawtextValue('DejaVu Sans'), 'DejaVu Sans');
  assert.equal(escapeDrawtextValue("a'b:c\\d"), "a'\\''b\\:c\\\\d");
});
