// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import type { Request, Response, NextFunction } from 'express';
import { parse as parseCookie } from 'cookie';
import crypto from 'crypto';
import { getConfig } from '../services/db/config.js';

const CSRF_COOKIE = 'aerie_csrf';
const CSRF_HEADER = 'x-csrf-token';

// Generate HMAC-signed token: random.signature
function generateToken(sessionToken: string): string {
  const random = crypto.randomBytes(32).toString('hex');
  const signature = crypto
    .createHmac('sha256', sessionToken)
    .update(random)
    .digest('hex');
  return `${random}.${signature}`;
}

// Verify token with timing-safe comparison
function verifyToken(token: string, sessionToken: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [random, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', sessionToken)
    .update(random)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch {
    return false;
  }
}

// The token below has never refused anything: every way it can fail resets the
// cookie and lets the request through (found Oct 22 2026, Ashen's open item).
// The browser now says on every request where it came from, so that is the
// gate: OWASP's CSRF cheat sheet names Sec-Fetch-Site the primary signal for
// modern browsers, with Origin as the mandatory fallback when it is missing.
// Only a request that carries the session cookie gets here, so curl, the
// lanes and webhooks (no cookie, no Sec-Fetch, no Origin) are untouched.
//
// It starts in REPORT mode: the house logs what it would refuse and refuses
// nothing, so it can be watched against the owner real phone before it enforces.
// security.csrf_mode: 'report' (unset), 'enforce', or 'off'.

export interface CrossSiteSignals {
  secFetchSite?: string;
  origin?: string;
  host?: string;
  forwardedHost?: string;
}

/** Why this request looks like it came from another site, or null when it does not. */
export function crossSiteVerdict(signals: CrossSiteSignals): string | null {
  const site = signals.secFetchSite?.trim().toLowerCase();
  if (site) {
    // 'none' is a request the person started themselves (typed, bookmarked).
    if (site === 'same-origin' || site === 'none') return null;
    return `Sec-Fetch-Site is ${site}`;
  }
  const origin = signals.origin?.trim();
  if (!origin) return null; // not a browser, or one too old to say
  if (origin === 'null') return 'Origin is null';
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return 'Origin is unreadable';
  }
  const hosts = [signals.host, signals.forwardedHost]
    .filter((h): h is string => typeof h === 'string' && h.length > 0)
    .flatMap((h) => h.split(',').map((part) => part.trim().toLowerCase()));
  return hosts.includes(originHost) ? null : `Origin ${originHost} is not this house`;
}

function csrfMode(): 'report' | 'enforce' | 'off' {
  try {
    const value = getConfig('security.csrf_mode');
    if (value === 'enforce' || value === 'off') return value;
  } catch {
    // No database yet (tests, first boot): report.
  }
  return 'report';
}

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Skip safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip localhost in development
  const host = req.get('host') || '';
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
    return next();
  }

  // Parse cookies manually (matching auth.ts pattern)
  const cookieHeader = req.headers.cookie;
  const cookies = cookieHeader ? parseCookie(cookieHeader) : {};

  // Skip unauthenticated requests (they'll fail auth anyway)
  const sessionToken = cookies.aerie_session;
  if (!sessionToken) {
    return next();
  }

  const mode = csrfMode();
  if (mode !== 'off') {
    const verdict = crossSiteVerdict({
      secFetchSite: req.get('sec-fetch-site'),
      origin: req.get('origin'),
      host: req.get('host'),
      forwardedHost: req.get('x-forwarded-host'),
    });
    if (verdict) {
      if (mode === 'enforce') {
        console.warn(`[CSRF] refused ${req.method} ${req.path}: ${verdict}`);
        res.status(403).json({ error: 'Cross-site request refused' });
        return;
      }
      console.warn(`[CSRF] would refuse ${req.method} ${req.path}: ${verdict} (report mode)`);
    }
  }

  // Check for existing CSRF cookie
  const existingToken = cookies[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);

  // Grace period: if no CSRF cookie exists, set one and allow request
  // This handles first request after login
  if (!existingToken) {
    const newToken = generateToken(sessionToken);
    res.cookie(CSRF_COOKIE, newToken, {
      httpOnly: false, // Frontend needs to read this
      secure: req.secure,
      sameSite: 'strict',
      path: '/',
    });
    return next();
  }

  // Validate: header must match cookie and signature must verify
  if (!headerToken || headerToken !== existingToken) {
    // Token mismatch — could be stale cookie after restart. Reset and allow (grace).
    const newToken = generateToken(sessionToken);
    res.cookie(CSRF_COOKIE, newToken, {
      httpOnly: false,
      secure: req.secure,
      sameSite: 'strict',
      path: '/',
    });
    return next();
  }

  if (!verifyToken(existingToken, sessionToken)) {
    // Signature invalid — session rotated but old CSRF cookie lingered. Reset and allow.
    const newToken = generateToken(sessionToken);
    res.cookie(CSRF_COOKIE, newToken, {
      httpOnly: false,
      secure: req.secure,
      sameSite: 'strict',
      path: '/',
    });
    return next();
  }

  // Rotate token on successful validation
  const newToken = generateToken(sessionToken);
  res.cookie(CSRF_COOKIE, newToken, {
    httpOnly: false,
    secure: req.secure,
    sameSite: 'strict',
    path: '/',
  });

  next();
}
