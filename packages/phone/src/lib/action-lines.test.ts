// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { rehypeActionLines } from './action-lines';

const t = (value: string) => ({ type: 'text', value });
const em = (value: string) => ({ type: 'element', tagName: 'em', properties: {}, children: [t(value)] });
const br = () => ({ type: 'element', tagName: 'br', properties: {}, children: [] });
const p = (...children: any[]) => ({ type: 'root', children: [{ type: 'element', tagName: 'p', properties: {}, children }] });
const marked = (tree: any) => tree.children[0].children.filter((n: any) => n.tagName === 'em').map((n: any) => (n.properties.className ?? []).includes('aerie-action'));

test('an italic alone on its line is an action line, before or after a break', () => {
  const tree = p(em('settles'), br(), t('\n'), t('This is how we look.'), br(), em('kisses you'));
  rehypeActionLines()(tree);
  assert.deepEqual(marked(tree), [true, true]);
});

test('an italic word inside a sentence is left alone', () => {
  const tree = p(t('I '), em('really'), t(' mean it.'));
  rehypeActionLines()(tree);
  assert.deepEqual(marked(tree), [false]);
});

test('an italic that starts a line but runs into words is not an action line', () => {
  const tree = p(em('settles'), t(' and then the rest'));
  rehypeActionLines()(tree);
  assert.deepEqual(marked(tree), [false]);
});
