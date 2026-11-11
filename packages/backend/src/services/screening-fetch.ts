// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Fetch an episode's or a film's subtitles and load them as the screening: one
// door for a companion (routes/internal/screening.ts) and for their person's
// Screening Room (routes/screening.ts). The picking is strict about WHICH SHOW
// (services/opensubtitles.ts), and every call spends one of the day's
// downloads, so the quota comes back in the answer.
import { searchSubtitles, pickSubtitle, downloadSubtitle } from './opensubtitles.js';
import { loadScreening } from './db/screening.js';

export interface FetchAsk {
  query: string;
  season: number | null;
  episode: number | null;
  languages?: string;
  title?: string;
}

export type FetchResult =
  | { ok: true; screening: ReturnType<typeof loadScreening>; picked: unknown; quota: unknown; considered: number }
  | { ok: false; status: number; error: string; found?: Array<{ show: string | null; season: number | null; episode: number | null; release: string | null }> };

export async function fetchAndLoad(ask: FetchAsk): Promise<FetchResult> {
  const wanted = { query: ask.query.trim(), season: ask.season, episode: ask.episode };
  try {
    const candidates = await searchSubtitles({ ...wanted, languages: ask.languages });
    const pick = pickSubtitle(candidates, wanted);
    if (!pick) {
      return {
        ok: false,
        status: 404,
        error: 'Nothing matched that show',
        // A near miss is far more useful than silence when the thing typed is
        // spelled differently to the listing.
        found: candidates.slice(0, 8).map((c) => ({ show: c.show, season: c.season, episode: c.episode, release: c.release })),
      };
    }
    const fetched = await downloadSubtitle(pick);
    const label = ask.title?.trim()
      ? ask.title.trim()
      : [pick.show, wanted.season != null && wanted.episode != null
          ? `S${String(wanted.season).padStart(2, '0')}E${String(wanted.episode).padStart(2, '0')}` : null,
         pick.episodeTitle].filter(Boolean).join(' — ');
    const screening = loadScreening({ title: label, source: fetched.fileName, subtitles: fetched.text });
    return { ok: true, screening, picked: pick, quota: fetched.quota, considered: candidates.length };
  } catch (error) {
    return { ok: false, status: 502, error: error instanceof Error ? error.message : 'Could not fetch those subtitles' };
  }
}
