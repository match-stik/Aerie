// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Timezone sovereignty layer.
 *
 * Every date/time calculation that matters for user-facing behavior
 * (agent context, Scribe digests, orchestrator scheduling, greetings,
 * DND checks, thread-name generation) MUST route through this module.
 *
 * Rationale: Node's bundled ICU ships tzdata that can be months behind
 * the current IANA releases. When IANA updates rules (e.g. Paraguay
 * abolishing DST in 2024), Node's `Intl.DateTimeFormat` and
 * `Date.prototype.toLocaleString` return stale offsets until Node
 * releases a minor that bumps ICU — often weeks or months later.
 *
 * `moment-timezone` ships its own tzdata as data files. When IANA
 * updates, `npm update moment-timezone` gives us the new rules
 * immediately, independent of the Node binary.
 *
 * DO NOT import `Intl.DateTimeFormat` or `toLocaleString` with a
 * `timeZone` option anywhere user-visible. Route through these helpers.
 */
import moment from 'moment-timezone';

/** "now" — an injection seam so tests can freeze time. */
export function now(): Date {
  return new Date();
}

/**
 * Local YYYY-MM-DD in the given zone. Used for day-keyed ledgers
 * (digests, hook scheduling, daily_wins).
 */
export function todayLocal(tz: string, at?: Date): string {
  return moment.tz(at ?? now(), tz).format('YYYY-MM-DD');
}

/** HH:mm 24-hour local time in the given zone. */
export function localTimeStr(tz: string, at?: Date): string {
  return moment.tz(at ?? now(), tz).format('HH:mm');
}

/** 12-hour local clock label: "2:35 AM". Used for inbox message stamps. */
export function localClock12(tz: string, at?: Date): string {
  return moment.tz(at ?? now(), tz).format('h:mm A');
}

/** Full local datestamp: "Sunday, 19 Apr". */
export function localDateStr(tz: string, at?: Date): string {
  return moment.tz(at ?? now(), tz).format('dddd, D MMM');
}

/** Full local date with year: "Monday, June 30, 2026". */
export function localDateFull(tz: string, at?: Date): string {
  return moment.tz(at ?? now(), tz).format('dddd, MMMM D, YYYY');
}

/** Combined "HH:mm DD/MM/YYYY" style for logs/digests. */
/**
 * The stamp on a message handed to a lane: "Wed 16 Sep, 11:56 PM".
 *
 * It carried the CLOCK ONLY until Sep 17 2026, when Rose and Sol reported the
 * consequence: after a recycle the date appears exactly once, at the top of an
 * orientation block, above a catch-up that can span days — so every line under
 * it reads as today. Sol wrote "Sunday" on a Monday. A companion has no other
 * clock; this label IS the date for them.
 *
 * Deliberately compact rather than the full date, because it is on every single
 * line: a weekday for the ordinary case of yesterday-versus-today, and the day
 * and month underneath it for a catch-up that reaches back further.
 */
export function localStamp(tz: string, at?: Date): string {
  return moment.tz(at ?? now(), tz).format('ddd D MMM, h:mm A');
}

export function localFullStr(tz: string, at?: Date): string {
  return moment.tz(at ?? now(), tz).format('DD/MM/YYYY, HH:mm:ss');
}

/**
 * Sortable local timestamp for log lines: "YYYY-MM-DD HH:mm:ss.SSS".
 * Year-first order keeps lexical sort matching chronological sort, and
 * the millisecond suffix matches the precision of the previous
 * `Date#toISOString()`-based format so log readers don't lose detail
 * when we move from UTC to wall-clock-in-tz.
 */
export function localLogStr(tz: string, at?: Date): string {
  return moment.tz(at ?? now(), tz).format('YYYY-MM-DD HH:mm:ss.SSS');
}

/** Local hour (0-23) as integer. Used for DND, quiet hours, scheduling. */
export function localHour(tz: string, at?: Date): number {
  return moment.tz(at ?? now(), tz).hour();
}

/** Local minute (0-59) as integer. */
export function localMinute(tz: string, at?: Date): number {
  return moment.tz(at ?? now(), tz).minute();
}

/**
 * Offset string like "-03:00" for the given zone at the given instant.
 * Use this when a label needs to surface the current offset correctly.
 */
export function offsetString(tz: string, at?: Date): string {
  return moment.tz(at ?? now(), tz).format('Z');
}

/**
 * Parse a date/time string with INTENT-AWARE timezone resolution:
 *
 *  - If the input carries an explicit UTC marker (`Z`) or an explicit
 *    `±HH:mm` offset, it's an absolute instant — parse it directly.
 *  - If the input is offsetless (e.g. `2026-04-26T09:00:00`,
 *    `2026-04-26 09:00`, or `2026-04-26`), interpret it as wall-clock
 *    time in the given timezone. This is the agent / CLI / human
 *    intent: "9 AM in my timezone", not "9 AM at the server's
 *    process locale".
 *
 * Returns null for unparseable input. The caller is expected to
 * surface a 400-shaped error.
 *
 * Used by timer creation and any other surface where the user supplies
 * a fire-time that should land on a specific local wall-clock moment.
 */
export function parseLocalDateTime(tz: string, input: string): Date | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Detect explicit timezone marker — Z, +HH:MM, +HHMM, -HH:MM, -HHMM
  // anchored to end-of-string. If present the input is absolute and
  // we just hand it to Date for parsing.
  const hasExplicitOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed);
  if (hasExplicitOffset) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Offsetless: interpret as a local wall-clock moment in `tz` via
  // moment-tz. Strict-mode parsing across the common shapes — anything
  // that doesn't match returns invalid and we yield null.
  const formats = [
    'YYYY-MM-DDTHH:mm:ss',
    'YYYY-MM-DDTHH:mm',
    'YYYY-MM-DD HH:mm:ss',
    'YYYY-MM-DD HH:mm',
    'YYYY-MM-DD',
  ];
  const parsed = moment.tz(trimmed, formats, true, tz);
  return parsed.isValid() ? parsed.toDate() : null;
}

/**
 * Offset from UTC in MINUTES for the given zone at the given instant.
 * Positive = ahead of UTC, negative = behind. Useful for SQLite
 * `date(col, '+N minutes')` modifiers where day boundaries must be
 * computed in a specific zone.
 */
export function offsetMinutes(tz: string, at?: Date): number {
  return moment.tz(at ?? now(), tz).utcOffset();
}

/**
 * UTC hour for a given moment — useful when an orchestrator check wants
 * the UTC wall time to compare against a configured UTC schedule.
 */
export function utcHour(at?: Date): number {
  return moment.utc(at ?? now()).hour();
}

/**
 * The runtime's local IANA zone id (browser or process default).
 * Used as a fallback when no explicit timezone is configured.
 */
export function systemTimezone(): string {
  return moment.tz.guess();
}

/**
 * Is `tz` a recognized IANA zone? Defensive guard before formatting
 * user-supplied zone strings.
 */
export function isValidTimezone(tz: string): boolean {
  return moment.tz.zone(tz) !== null;
}

/** Raw moment-timezone version + tzdata version, for diagnostics. */
export function tzdataInfo(): { momentVersion: string; dataVersion: string } {
  return {
    momentVersion: moment.version,
    dataVersion: String(moment.tz.dataVersion ?? 'unknown'),
  };
}

export interface TimezoneEntry {
  iana: string;        // 'America/Asuncion'
  city: string;        // 'Asuncion' or 'Buenos Aires'
  country: string;     // 'Paraguay' or 'Argentina'
  countryCode: string; // 'PY' or 'AR'
  region: string;      // 'America'
}

/**
 * Full list of IANA zones enriched with country metadata for UI display.
 *
 * Iterates every country moment-timezone knows (`moment.tz.countries()`),
 * maps each to its zones (`moment.tz.zonesForCountry(code)`), and labels
 * the country via `Intl.DisplayNames`. Zones with no associated country
 * in moment-tz (UTC, Etc/*) land in a synthetic 'Other' region.
 *
 * Sorted by region → country → city for stable rendering.
 */
export function listTimezonesWithMetadata(): TimezoneEntry[] {
  const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
  const result: TimezoneEntry[] = [];
  const seen = new Set<string>();

  for (const code of moment.tz.countries()) {
    const zones = moment.tz.zonesForCountry(code);
    if (!zones) continue;
    const country = displayNames.of(code) ?? code;
    for (const iana of zones) {
      if (seen.has(iana)) continue;
      seen.add(iana);
      const parts = iana.split('/');
      const region = parts[0];
      const city = parts[parts.length - 1].replace(/_/g, ' ');
      result.push({ iana, city, country, countryCode: code, region });
    }
  }

  // Pick up orphan zones (UTC, Etc/*, some historical pseudo-zones) that
  // have no country affiliation. They land under "Other".
  for (const iana of moment.tz.names()) {
    if (seen.has(iana)) continue;
    seen.add(iana);
    const parts = iana.split('/');
    const hasSlash = parts.length > 1;
    result.push({
      iana,
      city: (parts[parts.length - 1] ?? iana).replace(/_/g, ' '),
      country: '',
      countryCode: '',
      region: hasSlash ? parts[0] : 'Other',
    });
  }

  result.sort((a, b) => {
    if (a.region !== b.region) return a.region.localeCompare(b.region);
    if (a.country !== b.country) return a.country.localeCompare(b.country);
    return a.city.localeCompare(b.city);
  });

  return result;
}

// ---------------------------------------------------------------------------
// Cron scheduling — sovereignty-aware next-fire computation.
//
// External schedulers (croner etc) resolve cron timezones via Node's Intl,
// which carries the same stale tzdata problem as Date.toLocaleString. That
// makes a `0 8 * * *` cron in America/Asuncion fire at 9 AM local wall-clock
// on installs where Node still thinks Asunción is UTC−4.
//
// These helpers do the resolution via moment-timezone instead, so every
// scheduled fire lands on the correct local wall-clock time regardless of
// Node's ICU freshness.
// ---------------------------------------------------------------------------

type CronField =
  | { kind: 'wildcard' }
  | { kind: 'fixed'; value: number }
  | { kind: 'step'; value: number }
  | { kind: 'range'; min: number; max: number }
  | { kind: 'list'; values: number[] };

interface CronFields {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

// Valid value ranges per field position. Cron uses 0=Sunday for dayOfWeek;
// moment also uses 0=Sunday so no translation needed.
const FIELD_BOUNDS: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // dayOfMonth
  [1, 12], // month
  [0, 6],  // dayOfWeek (0=Sun, 6=Sat)
];

function inBounds(n: number, [min, max]: [number, number]): boolean {
  return Number.isInteger(n) && n >= min && n <= max;
}

function parseCronField(raw: string, bounds: [number, number]): CronField | null {
  if (raw === '*') return { kind: 'wildcard' };

  // Single fixed integer
  if (/^\d+$/.test(raw)) {
    const v = parseInt(raw, 10);
    return inBounds(v, bounds) ? { kind: 'fixed', value: v } : null;
  }

  // Step value: */N (applied over the full field range)
  const stepMatch = raw.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const n = parseInt(stepMatch[1], 10);
    return n > 0 ? { kind: 'step', value: n } : null;
  }

  // Range: min-max (inclusive)
  const rangeMatch = raw.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10);
    const hi = parseInt(rangeMatch[2], 10);
    if (inBounds(lo, bounds) && inBounds(hi, bounds) && lo <= hi) {
      return { kind: 'range', min: lo, max: hi };
    }
    return null;
  }

  // List: v1,v2,v3
  if (raw.includes(',')) {
    const pieces = raw.split(',');
    const values: number[] = [];
    for (const p of pieces) {
      if (!/^\d+$/.test(p)) return null;
      const v = parseInt(p, 10);
      if (!inBounds(v, bounds)) return null;
      values.push(v);
    }
    return values.length > 0 ? { kind: 'list', values } : null;
  }

  return null;
}

/**
 * Parse a cron expression into structured fields. Returns null for
 * malformed expressions, out-of-range values, or mixed patterns we don't
 * support (e.g. `1-5/2` step-within-range). Callers should treat null
 * as "can't schedule this cron safely via our sovereignty-aware path."
 *
 * Supported per field: wildcard, fixed integer, step ("slash-N"),
 * range ("min-max"), list ("v1,v2,v3").
 *
 * @internal Exported for testing
 */
export function parseCron(expr: string): CronFields | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const fields: (CronField | null)[] = parts.map((p, i) =>
    parseCronField(p, FIELD_BOUNDS[i]),
  );
  if (fields.some((f) => f === null)) return null;
  const [m, h, dom, mo, dow] = fields as CronField[];
  return { minute: m, hour: h, dayOfMonth: dom, month: mo, dayOfWeek: dow };
}

function matchesField(value: number, field: CronField): boolean {
  switch (field.kind) {
    case 'wildcard':
      return true;
    case 'fixed':
      return value === field.value;
    case 'step':
      return value % field.value === 0;
    case 'range':
      return value >= field.min && value <= field.max;
    case 'list':
      return field.values.includes(value);
  }
}

/**
 * Next fire time for a cron expression in a given timezone, computed via
 * moment-timezone (independent of Node's ICU). Walks forward one minute at
 * a time from `from + 1 minute` until it finds a local time that matches
 * every field. Returns null for unsupported cron patterns or if nothing
 * matches within a week (protects against malformed expressions).
 *
 * Day-of-month and day-of-week use AND semantics here (both must match
 * if both are non-wildcard) — simpler than cron's historical OR semantics
 * and sufficient for the fixed-daily wake patterns we use.
 *
 * @internal Exported for testing
 */
export function cronNextFireTime(
  cronExpr: string,
  tz: string,
  from: Date = now(),
): Date | null {
  const fields = parseCron(cronExpr);
  if (!fields) return null;

  // Start one minute past `from` so we don't re-fire on the same minute.
  const candidate = moment.tz(from, tz).add(1, 'minute').second(0).millisecond(0);
  const maxIterations = 7 * 24 * 60; // one week

  for (let i = 0; i < maxIterations; i++) {
    if (
      matchesField(candidate.minute(), fields.minute) &&
      matchesField(candidate.hour(), fields.hour) &&
      matchesField(candidate.date(), fields.dayOfMonth) &&
      matchesField(candidate.month() + 1, fields.month) && // moment months are 0-indexed; cron is 1-indexed
      matchesField(candidate.day(), fields.dayOfWeek)
    ) {
      return candidate.toDate();
    }
    candidate.add(1, 'minute');
  }
  return null;
}

/**
 * Validate a cron expression for use with ScheduledTask. True only if the
 * parser recognizes every field — unsupported patterns (ranges, lists)
 * return false so callers can reject them at config time rather than
 * having cronNextFireTime return null at schedule time.
 */
export function isCronSupported(expr: string): boolean {
  return parseCron(expr) !== null;
}
