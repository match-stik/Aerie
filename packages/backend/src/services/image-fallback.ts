// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Which backend takes the picture when the first one won't.
 *
 * Studio has had three working backends since August and no rule on top of
 * them, so a refused job just failed and somebody had to notice and re-run it
 * by hand. Somebody remembered this being wired; it never was. The shape was
 * visible — three backends, one call, the same reference drawers — which is
 * exactly the kind of thing a person assumes is plugged in.
 *
 * Two deliberate refusals in here:
 *
 *  - NOTHING CONSULTS A READINESS FLAG. GET /api/studio/backends reported
 *    codex ready:true through a total outage on Sep 3 2026, because it
 *    describes configuration and never live capability. The only honest test
 *    of whether a backend will take a job is giving it one.
 *  - A PAID BACKEND IS NEVER IN THE DEFAULT CHAIN. Falling over from a free
 *    backend into a metered one turns an outage into a bill the owner never chose.
 *    A paid backend therefore runs only when it is the backend that was
 *    actually asked for, or when the owner has typed it into the chain themselves —
 *    the code does not second-guess a chain the owner wrote, it only refuses to
 *    invent one. There is a test on the default for exactly this.
 */

export type ImageBackend = 'codex' | 'openai' | 'antigravity' | 'openart';

export const KNOWN_BACKENDS: ImageBackend[] = ['codex', 'openai', 'antigravity', 'openart'];

/** Metered per image. Never auto-entered — see the note above. */
export const PAID_BACKENDS = new Set<ImageBackend>(['openai']);

/** The order tried when nothing is configured. Both of these are covered by a
 *  subscription the owner already has; openart stays out unless configured. */
export const DEFAULT_FALLBACK_CHAIN: ImageBackend[] = ['codex', 'antigravity'];

export function parseFallbackChain(raw: string | null | undefined): ImageBackend[] {
  if (typeof raw !== 'string') return [...DEFAULT_FALLBACK_CHAIN];
  const parsed = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part): part is ImageBackend => (KNOWN_BACKENDS as string[]).includes(part));
  // An empty or unparseable setting means "no fallback", not "use the default" —
  // switching it off has to be possible without deleting the key.
  return raw.trim() === '' ? [] : dedupe(parsed);
}

function dedupe(list: ImageBackend[]): ImageBackend[] {
  const seen = new Set<ImageBackend>();
  const out: ImageBackend[] = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * The full ordered list of backends to try for one request: what was asked for
 * first, then the chain, with duplicates dropped so a backend is never given
 * two goes at the same job.
 */
export function planAttempts(requested: ImageBackend, chain: ImageBackend[]): ImageBackend[] {
  return dedupe([requested, ...chain]);
}

export interface AttemptRecord {
  backend: ImageBackend;
  error: string;
}

export class AllBackendsFailedError extends Error {
  readonly attempts: AttemptRecord[];
  constructor(attempts: AttemptRecord[]) {
    super(
      attempts.length === 1
        ? attempts[0].error
        : `Every image backend refused this one. ${attempts
            .map((a) => `${a.backend}: ${a.error}`)
            .join(' | ')}`,
    );
    this.name = 'AllBackendsFailedError';
    this.attempts = attempts;
  }
}

export interface FallbackOutcome<T> {
  result: T;
  /** The backend that actually produced the picture. */
  backend: ImageBackend;
  /** Everything that refused first, in order. Empty when the first one worked. */
  failed: AttemptRecord[];
}

/**
 * Walk the order until one of them produces something. Throws
 * AllBackendsFailedError carrying every refusal, so the reason the FIRST one
 * said no survives — otherwise a fallback that also fails hides the real fault
 * behind the last backend's error message.
 */
export async function runWithFallback<T>(
  order: ImageBackend[],
  run: (backend: ImageBackend) => Promise<T>,
): Promise<FallbackOutcome<T>> {
  const failed: AttemptRecord[] = [];
  for (const backend of order) {
    try {
      const result = await run(backend);
      return { result, backend, failed };
    } catch (error) {
      failed.push({ backend, error: error instanceof Error ? error.message : String(error) });
    }
  }
  throw new AllBackendsFailedError(failed);
}
