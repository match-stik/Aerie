// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Painter credits for the Usage tab. A prepaid balance has no window and no cap,
// so the card shows the number left rather than a bar: OpenArt credits through
// the same MCP login the painter uses. Cached a minute, like the other meters,
// so a phone left open on the tab asks no more than that.

export interface PainterBalance {
  /** What is left, in the painter's own unit. */
  balance: number;
  unit: 'credits' | 'gems';
  plan: string | null;
}

export interface ImageCredits {
  openart: PainterBalance | null;
  openartError: string | null;
  mage: PainterBalance | null;
  mageError: string | null;
  readAt: string;
}

/** OpenArt's account tool answers with JSON (sometimes inside prose):
 *  {"user":{...},"plan":"Pro","credits":23362}. */
export function parseOpenArtAccount(text: string): PainterBalance | null {
  const tryParse = (s: string): Record<string, unknown> | null => {
    try { const v = JSON.parse(s); return v && typeof v === 'object' ? v as Record<string, unknown> : null; } catch { return null; }
  };
  let body = tryParse(text.trim());
  if (!body) {
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t.startsWith('{')) { body = tryParse(t); if (body) break; }
    }
  }
  if (!body) return null;
  const credits = Number(body.credits);
  if (!Number.isFinite(credits)) return null;
  return { balance: credits, unit: 'credits', plan: typeof body.plan === 'string' && body.plan ? body.plan : null };
}

const CACHE_MS = 60_000;
let cache: { at: number; value: ImageCredits } | null = null;

export async function getImageCredits(): Promise<ImageCredits> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const { openartAccountText } = await import('./image-gen/openart.js');
  const [oa] = await Promise.allSettled([openartAccountText()]);
  // This house has no Mage painter, so its balance is never asked for.
  const value: ImageCredits = { openart: null, openartError: null, mage: null, mageError: null, readAt: new Date().toISOString() };
  if (oa.status === 'fulfilled') {
    value.openart = parseOpenArtAccount(oa.value);
    if (!value.openart) value.openartError = 'OpenArt answered without a credit count.';
  } else {
    value.openartError = oa.reason instanceof Error ? oa.reason.message : 'OpenArt unavailable.';
  }
  cache = { at: Date.now(), value };
  return value;
}
