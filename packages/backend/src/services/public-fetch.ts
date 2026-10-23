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

/** True only for an address on the open internet. Anything unreadable is not public. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPublicIPv4(ip);
  if (kind !== 6) return false;
  const lower = ip.toLowerCase();
  // An IPv4 address dressed as IPv6 is judged as the IPv4 address it carries.
  const mapped = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIPv4(mapped[1]);
  if (lower === '::' || lower === '::1') return false;
  const first = parseInt(lower.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
  if ((first & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
  if ((first & 0xff00) === 0xff00) return false; // multicast
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
  const fetchImpl = options.fetchImpl ?? fetch;
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
