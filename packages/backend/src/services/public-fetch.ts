// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Fetching a URL somebody else chose.
//
// The house fetches pictures it is handed so the companions can see them: a
// bare image link in the owner's message, and every Discord attachment, embed,
// emote and sticker. An embed's image is the linked page's choice, so a
// stranger in a Discord room can point it anywhere, including this box's own
// loopback doors (127.0.0.1:3013 answers without auth because nothing outside
// the box can reach it). Found Oct 22 2026 checking the house against OWASP's
// 2025 list, which folds this (SSRF) into Broken Access Control: the fetch had
// no address check, no size cap and no timeout. This is the one door those
// fetches leave by now.
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

export type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export interface PublicFetchOptions {
  /** Refuse a body larger than this, read off the stream, not trusted from headers. */
  maxBytes?: number;
  /** Give up on the whole fetch, redirects included, after this long. */
  timeoutMs?: number;
  /** Redirects followed by hand, each hop checked again. */
  maxRedirects?: number;
  accept?: string;
  lookup?: LookupFn;
  fetchImpl?: typeof fetch;
}

export interface PublicFetchResult {
  contentType: string;
  bytes: Buffer;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 3;

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts;
}

function isPublicIPv4(ip: string): boolean {
  const p = ipv4Parts(ip);
  if (!p) return false;
  const [a, b] = p;
  if (a === 0) return false; // this network
  if (a === 10) return false; // private
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT, and the tailnet lives here
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 0 && p[2] === 0) return false; // IETF protocol assignments
  if (a === 192 && b === 168) return false; // private
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/**
 * An IPv6 address as its eight 16-bit groups, or null. A dotted IPv4 tail
 * (::ffff:127.0.0.1) is folded into the last two groups, so every spelling of
 * the same address comes out the same.
 */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const v4 = ipv4Parts(dotted[2]);
    if (!v4) return null;
    text = `${dotted[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const read = (part: string) => (part ? part.split(':').map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)) : []);
  const head = read(halves[0]);
  const tail = halves.length === 2 ? read(halves[1]) : [];
  if ([...head, ...tail].some((g) => Number.isNaN(g))) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array(missing).fill(0), ...tail];
}

/**
 * True only for an address on the open internet. Anything unreadable is not
 * public. An IPv4 address carried inside an IPv6 one is judged as the IPv4
 * address, however it is spelled: Node's URL parser writes [::ffff:127.0.0.1]
 * as ::ffff:7f00:1, which a dotted-only check let through.
 */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPublicIPv4(ip);
  if (kind !== 6) return false;
  const g = ipv6Groups(ip);
  if (!g) return false;
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeros(8)) return false; // ::
  if (zeros(7) && g[7] === 1) return false; // ::1
  if (zeros(5) && g[5] === 0xffff) return isPublicIPv4(v4(g[6], g[7])); // ::ffff:a.b.c.d, mapped
  if (zeros(6)) return isPublicIPv4(v4(g[6], g[7])); // ::a.b.c.d, the old compatible form
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPublicIPv4(v4(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isPublicIPv4(v4(g[1], g[2])); // 6to4 carries one too
  if ((g[0] & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return false; // old site-local fec0::/10
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  return true;
}

const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/** Whether this URL is one the house may fetch: http(s), and every address it resolves to public. */
export async function isPublicUrl(url: string, lookup: LookupFn = defaultLookup): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!host) return false;
  try {
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host);
    return addresses.length > 0 && addresses.every((entry) => isPublicAddress(entry.address));
  } catch {
    return false;
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

/**
 * The DNS lookup a socket uses at the moment it connects, answering only
 * public addresses. Checking a name and then letting fetch look it up again
 * left a gap a short-lived DNS answer could slip through, public for the check
 * and loopback for the connect. With this
 * the address the socket dials is the address that was checked.
 */
export function publicOnlyLookup(lookup: LookupFn) {
  return (hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback): void => {
    lookup(hostname).then(
      (addresses) => {
        if (!addresses.length || !addresses.every((entry) => isPublicAddress(entry.address))) {
          callback(Object.assign(new Error(`refused ${hostname}: not a public address`), { code: 'EREFUSED' }), '');
          return;
        }
        if (typeof options === 'object' && options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
      (error: NodeJS.ErrnoException) => callback(error, ''),
    );
  };
}

const pinnedAgents = new WeakMap<LookupFn, Agent>();

/** fetch with every connection's address checked by publicOnlyLookup. */
function pinnedFetch(lookup: LookupFn): typeof fetch {
  let agent = pinnedAgents.get(lookup);
  if (!agent) {
    agent = new Agent({ connect: { lookup: publicOnlyLookup(lookup) } });
    pinnedAgents.set(lookup, agent);
  }
  const dispatcher = agent;
  return ((input: string, init?: RequestInit) =>
    undiciFetch(input, { ...(init ?? {}), dispatcher } as Parameters<typeof undiciFetch>[1])) as unknown as typeof fetch;
}

async function readCapped(response: Response, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Fetch a URL that came from outside: only the open internet, every redirect
 * checked again, a byte cap read off the stream and a timeout over the whole
 * thing. Resolves to null for anything refused or failed; it never throws.
 */
export async function fetchPublic(url: string, options: PublicFetchOptions = {}): Promise<PublicFetchResult | null> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const lookup = options.lookup ?? defaultLookup;
  const fetchImpl = options.fetchImpl ?? pinnedFetch(lookup);
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let current = url;
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (!(await isPublicUrl(current, lookup))) return null;
      const response = await fetchImpl(current, {
        redirect: 'manual',
        signal,
        headers: options.accept ? { Accept: options.accept } : undefined,
      });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!next) return null;
        current = new URL(next, current).toString();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return null;
      }
      const bytes = await readCapped(response, maxBytes);
      if (!bytes) return null;
      return { contentType: response.headers.get('content-type') || '', bytes };
    }
    return null;
  } catch {
    return null;
  }
}
