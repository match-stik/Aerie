// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
const { rememberToyName, setToyName, toyName } = await import('./toy-names');

test('a Bluetooth address is never shown as a name', () => {
  assert.equal(toyName({ toyId: 'AA:BB:CC:DD:EE:FF', name: 'AA:BB:CC:DD:EE:FF' }), 'Your toy');
});

test('a real name is used and remembered, and their own name wins', () => {
  rememberToyName({ toyId: 'a1', fullName: 'Lovense Ferri' });
  assert.equal(toyName({ toyId: 'a1' }), 'Lovense Ferri');
  setToyName('a1', 'Fizz');
  assert.equal(toyName({ toyId: 'a1', fullName: 'Lovense Ferri' }), 'Fizz');
  setToyName('a1', '');
  assert.equal(toyName({ toyId: 'a1', fullName: 'Lovense Ferri' }), 'Lovense Ferri');
  assert.equal(toyName({ toyId: 'b2', type: 'domi' }), 'Lovense Domi');
});
