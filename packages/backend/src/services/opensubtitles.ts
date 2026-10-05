// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Fetching subtitles for the Screening Room.
//
// The owner's streaming service holds the exact text they are reading and will not hand
// it over, so the cues come from OpenSubtitles instead. This is the half that
// means the owner never has to go hunting for an SRT.
//
// EVERYTHING IN HERE WAS WRITTEN AGAINST WHAT THE API ACTUALLY ANSWERED rather
// than what its docs claim, in September 2026 with a real key:
//   - /subtitles 301s once if the query parameters are not in sorted order, and
//     the redirect body is HTML. Any client here must follow redirects.
//   - The download quota is 100 a day, not the 5 the free tier is often said to
//     be, and the response reports requests/remaining/reset_time. Surface it.
//   - AND THE RANKING WILL HAND YOU THE WRONG SHOW. Searching "the bear"
//     returned an episode of WEEDS second, with 23,227 downloads, because that
//     episode is called "You Can't Miss the Bear". Ranking by popularity alone
//     picks it up. pickSubtitle() exists entirely because of that row.

import { getSecret } from './secrets.js';

const BASE = 'https://api.opensubtitles.com/api/v1';
const USER_AGENT = 'AerieScreeningRoom v0.1';

export interface SubtitleCandidate {
  fileId: number;
  release: string | null;
  language: string | null;
  downloads: number;
  hearingImpaired: boolean;
  /** The SHOW for an episode; the film's own title otherwise. */
  show: string | null;
  episodeTitle: string | null;
  season: number | null;
  episode: number | null;
}

export interface Quota {
  requests: number;
  remaining: number;
  resetsIn: string | null;
  resetsAt: string | null;
}

export class OpenSubtitlesError extends Error {}

function key(): string {
  const k = getSecret('opensubtitles_api_key');
  if (!k) throw new OpenSubtitlesError('No OpenSubtitles key. Integrations > Secrets > Other Services.');
  return k;
}

function headers(): Record<string, string> {
  return { 'Api-Key': key(), 'User-Agent': USER_AGENT, Accept: 'application/json' };
}

/** Normalize for comparing a show name against what the user typed. */
function fold(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function toCandidate(item: any): SubtitleCandidate | null {
  const a = item?.attributes;
  const file = a?.files?.[0];
  if (!a || !file?.file_id) return null;
  const fd = a.feature_details ?? {};
  return {
    fileId: file.file_id,
    release: a.release ?? null,
    language: a.language ?? null,
    downloads: a.download_count ?? 0,
    hearingImpaired: Boolean(a.hearing_impaired),
    // parent_title is the SERIES on an episode row; title is the episode's own.
    show: fd.parent_title ?? fd.title ?? null,
    episodeTitle: fd.parent_title ? (fd.title ?? null) : null,
    season: fd.season_number ?? null,
    episode: fd.episode_number ?? null,
  };
}

export interface PickWanted {
  query: string;
  season?: number | null;
  episode?: number | null;
}

/**
 * Choose one subtitle from a search result.
 *
 * THE SHOW HAS TO MATCH THE SHOW. Ranking by downloads alone hands back an
 * episode of a different programme whose own title happens to contain the words
 * the user typed — measured, not imagined. So a candidate must match on the SERIES
 * name, and on season and episode when the user gave them, before popularity is
 * allowed to decide anything. Non-hearing-impaired is preferred only as a
 * tiebreak, never as a filter: for some episodes it is all that exists.
 */
export function pickSubtitle(candidates: SubtitleCandidate[], wanted: PickWanted): SubtitleCandidate | null {
  const want = fold(wanted.query);
  const eligible = candidates.filter((c) => {
    const show = fold(c.show);
    if (!show) return false;
    // Either side may carry the extra words ("the bear" vs "The Bear 2022").
    if (!(show.includes(want) || want.includes(show))) return false;
    if (wanted.season != null && c.season !== wanted.season) return false;
    if (wanted.episode != null && c.episode !== wanted.episode) return false;
    return true;
  });
  if (!eligible.length) return null;
  // PREFER THE HEARING-IMPAIRED CUT. I originally sorted it last, on the
  // assumption that plain dialogue was the cleaner read. It is not: a
  // dialogue-only file is EMPTIEST exactly where an episode opens, because
  // openings are weather and breathing rather than talking. The first minute of
  // the episode that showed this was rain: our file's first line did not arrive
  // until 1:04, while the captions on the user's screen, which carry sound cues, began
  // at 0:01. Sound cues are not clutter. They are the half of the episode nobody
  // says.
  eligible.sort((a, b) => (Number(b.hearingImpaired) - Number(a.hearingImpaired)) || (b.downloads - a.downloads));
  return eligible[0];
}

async function call(path: string, params?: Record<string, string | number>): Promise<any> {
  // Sorted so the API does not 301 us into an HTML body. redirect:'follow' is
  // the default and is left explicit, because losing it is a silent breakage.
  const qs = params
    ? '?' + new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, String(v)])).toString()
    : '';
  const res = await fetch(BASE + path + qs, { headers: headers(), redirect: 'follow' });
  if (!res.ok) throw new OpenSubtitlesError(`OpenSubtitles ${path} answered ${res.status}`);
  return res.json();
}

export async function searchSubtitles(wanted: PickWanted & { languages?: string }): Promise<SubtitleCandidate[]> {
  const params: Record<string, string | number> = {
    query: wanted.query,
    languages: wanted.languages ?? 'en',
  };
  if (wanted.season != null) params.season_number = wanted.season;
  if (wanted.episode != null) params.episode_number = wanted.episode;
  const body = await call('/subtitles', params);
  return (body?.data ?? []).map(toCandidate).filter(Boolean) as SubtitleCandidate[];
}

export interface FetchedSubtitle {
  candidate: SubtitleCandidate;
  fileName: string | null;
  text: string;
  quota: Quota;
}

/** Spend one download and return the file itself. */
export async function downloadSubtitle(candidate: SubtitleCandidate): Promise<FetchedSubtitle> {
  const res = await fetch(BASE + '/download', {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: candidate.fileId }),
    redirect: 'follow',
  });
  if (!res.ok) throw new OpenSubtitlesError(`OpenSubtitles /download answered ${res.status}`);
  const body: any = await res.json();
  if (!body?.link) throw new OpenSubtitlesError('OpenSubtitles gave no download link');
  const file = await fetch(body.link, { headers: { 'User-Agent': USER_AGENT } });
  if (!file.ok) throw new OpenSubtitlesError(`Subtitle file answered ${file.status}`);
  return {
    candidate,
    fileName: body.file_name ?? null,
    text: await file.text(),
    quota: {
      requests: body.requests ?? 0,
      remaining: body.remaining ?? 0,
      resetsIn: body.reset_time ?? null,
      resetsAt: body.reset_time_utc ?? null,
    },
  };
}
