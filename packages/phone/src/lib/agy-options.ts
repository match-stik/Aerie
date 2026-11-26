// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Studio's Gemini menu is read off the signed-in Antigravity account (GET
// /api/studio/antigravity/models, Nov 26 2026). The house hands back the names
// agy prints; this turns each into a menu row, short name on the button, the
// effort level as its note.

export interface AgyOption { id: string; name: string; desc: string }

export function agyOption(id: string): AgyOption {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(id);
  const base = (m ? m[1] : id).replace(/^Gemini\s+/i, '').trim();
  const level = m ? m[2].trim() : '';
  return { id, name: base || id, desc: level };
}

export function agyOptionsFrom(data: unknown): AgyOption[] {
  const list = (data as { models?: unknown } | null)?.models;
  if (!Array.isArray(list)) return [];
  return list.filter((n): n is string => typeof n === 'string' && n.trim() !== '').map(agyOption);
}
