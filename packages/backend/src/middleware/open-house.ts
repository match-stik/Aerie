// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A house with no password trusts whoever can reach it. That is reasonable
// only while the only one who can reach it is this machine, so two rules hold
// for a house with no password:
//
// - It will not start on an address other machines can reach. Binding to
//   0.0.0.0 or a network address with no password publishes every route, keys
//   included, to the network.
// - It answers only requests whose Host names this machine or one of the
//   configured cors.origins. A page in a browser on this machine can point its
//   own hostname at 127.0.0.1 (DNS rebinding) and read the answers as its own;
//   its Host header still names the page's site, which is how it is told apart.
//
// A password lifts both: the login cookie then decides who gets in.

import type { Request, Response, NextFunction } from 'express';

const LOOPBACK_BINDS = new Set(['127.0.0.1', 'localhost', '::1']);
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i;

/** True when the server is bound only to this machine. */
export function isLoopbackBind(host: string | undefined): boolean {
  return LOOPBACK_BINDS.has(String(host ?? '').trim().toLowerCase());
}

/** The Host values a house with no password answers: the loopback names, and the hosts of its cors.origins. */
export function allowedHostsFrom(origins: ReadonlyArray<string>): Set<string> {
  const hosts = new Set<string>();
  for (const origin of origins) {
    try { hosts.add(new URL(origin).host.toLowerCase()); } catch { /* not a URL: ignore */ }
  }
  return hosts;
}

export function openHouseHostAllowed(host: string | undefined, allowed: ReadonlySet<string>): boolean {
  if (!host) return true; // HTTP/1.0 with no Host: not a browser
  if (LOOPBACK_HOST.test(host)) return true;
  return allowed.has(host.toLowerCase());
}

/** Express middleware: only acts while no password is set. */
export function openHouseGuard(hasPassword: () => boolean, allowed: ReadonlySet<string>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (hasPassword() || openHouseHostAllowed(req.headers.host, allowed)) {
      next();
      return;
    }
    console.warn(`[open-house] refused ${req.method} ${req.originalUrl} — host ${req.headers.host}`);
    res.status(421).json({ error: 'This house has no password, so it only answers its own address. Set a password, or add this address to cors.origins.' });
  };
}
