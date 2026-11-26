// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agyOption, agyOptionsFrom } from './agy-options.js';

test('a painter name becomes a short button and its level', () => {
  assert.deepEqual(agyOption('Gemini 4 Hydrogen (XHigh)'), { id: 'Gemini 4 Hydrogen (XHigh)', name: '4 Hydrogen', desc: 'XHigh' });
  assert.deepEqual(agyOption('Gemini 3.8 Flash (High)'), { id: 'Gemini 3.8 Flash (High)', name: '3.8 Flash', desc: 'High' });
});

test('the house reply becomes the menu, and junk is dropped', () => {
  assert.deepEqual(agyOptionsFrom({ models: ['Gemini 3.8 Flash (Low)', '', 4] }).map(o => o.id), ['Gemini 3.8 Flash (Low)']);
  assert.deepEqual(agyOptionsFrom(null), []);
});
