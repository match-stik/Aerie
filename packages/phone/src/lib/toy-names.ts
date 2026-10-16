// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// What a toy is called. Lovense's SDK names some toys by their Bluetooth
// address alone (the owner Fizz came through as 7C:31:FA:A9:33:D7, Oct 19 2026),
// so a name the owner gives a toy wins, an address is never shown as a name, and a
// name seen once is remembered on this phone per toy id. The Toys page and
// the remote the house drives both read this one place.

const NAMES_KEY = 'aerie.toy-names';
const OWNER_KEY = 'aerie.toy-names-owner';

const looksLikeAddress = (s: string) => /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(s.trim());

function read(key: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; }
}
function write(key: string, all: Record<string, string>): void {
  try { localStorage.setItem(key, JSON.stringify(all)); } catch { /* a name is a nicety */ }
}

interface Named { toyId: string; fullName?: string | null; name?: string | null; type?: string | null }

function sdkName(toy: Named): string {
  for (const n of [toy.fullName, toy.name]) {
    const v = (n || '').trim();
    if (v && !looksLikeAddress(v)) return v;
  }
  const t = (toy.type || '').trim();
  return t && !looksLikeAddress(t) ? `Lovense ${t.charAt(0).toUpperCase()}${t.slice(1)}` : '';
}

/** Remember the SDK's name for a toy, when it gives a real one. */
export function rememberToyName(toy: Named): void {
  const name = sdkName(toy);
  if (!toy.toyId || !name) return;
  const all = read(NAMES_KEY);
  if (all[toy.toyId] !== name) { all[toy.toyId] = name; write(NAMES_KEY, all); }
}

/** Their own name for a toy; an empty name clears it. */
export function setToyName(toyId: string, name: string): void {
  const all = read(OWNER_KEY);
  if (name.trim()) all[toyId] = name.trim(); else delete all[toyId];
  write(OWNER_KEY, all);
}

export function toyName(toy: Named): string {
  return read(OWNER_KEY)[toy.toyId] || sdkName(toy) || read(NAMES_KEY)[toy.toyId] || 'Your toy';
}
