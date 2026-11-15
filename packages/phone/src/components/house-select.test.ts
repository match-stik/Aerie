// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The house's own picker, so no list opens gray. It reads
// <option>/<optgroup> children the way a browser does, and no room in the
// phone opens Android's system list any more.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HouseSelect, readOptions } from './HouseSelect';

const h = createElement;

test('reads options, groups, fragments and mapped arrays the way a browser would', () => {
  const opts = readOptions([
    h('option', { key: 'a', value: '' }, 'Default'),
    h('optgroup', { key: 'g', label: 'Claude' },
      ['opus', 'fable'].map((m) => h('option', { key: m, value: m }, m.toUpperCase()))),
    h(Fragment, { key: 'f' }, h('option', { value: 3 }, 'Three'), h('option', { disabled: true }, 'No value')),
  ]);
  assert.deepEqual(opts, [
    { value: '', label: 'Default', disabled: false, group: undefined },
    { value: 'opus', label: 'OPUS', disabled: false, group: 'Claude' },
    { value: 'fable', label: 'FABLE', disabled: false, group: 'Claude' },
    { value: '3', label: 'Three', disabled: false, group: undefined },
    { value: 'No value', label: 'No value', disabled: true, group: undefined },
  ]);
});

test('the closed control shows the chosen label, and the first when nothing matches', () => {
  const kids = [h('option', { key: 1, value: 'a' }, 'Apple'), h('option', { key: 2, value: 'b' }, 'Bean')];
  assert.match(renderToStaticMarkup(h(HouseSelect, { value: 'b', className: 'x' }, kids)), /<span[^>]*>Bean<\/span>/);
  assert.match(renderToStaticMarkup(h(HouseSelect, { value: 'zzz' }, kids)), /<span[^>]*>Apple<\/span>/);
  assert.match(renderToStaticMarkup(h(HouseSelect, { value: null }, kids)), /<span[^>]*>Apple<\/span>/);
});

test('no component opens a native <select> any more', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.tsx')) continue;
      const src = readFileSync(p, 'utf8').replace(/\/\/.*$/gm, '');
      if (/<select[\s>]/.test(src)) found.push(p.slice(root.length));
    }
  };
  walk(root);
  assert.deepEqual(found, [], 'use HouseSelect so the list wears the palette');
});
