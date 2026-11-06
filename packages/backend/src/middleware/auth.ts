// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Request, Response, NextFunction } from 'express';
import { parse as parseCookie } from 'cookie';
import crypto from 'crypto';
import type { WebSession } from '@aerie/shared';
import {
  createWebSession,
  getWebSession,
  touchWebSession,
  deleteExpiredSessions,
  deleteWebSession,
} from '../services/db.js';
import { getAerieConfig } from '../config.js';

const COOKIE_NAME = 'aerie_session';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Sliding renewal: an active session buys itself a fresh 7 days, so living in
// the app never logs the user out. Only rewritten once a day's worth of the window
// has actually been spent — ordinary traffic costs no writes and no Set-Cookie.
const SESSION_RENEW_AFTER_MS = 24 * 60 * 60 * 1000; // 1 day

export function getCookieName(): string {
  return COOKIE_NAME;
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  // Only mark the cookie Secure when the connection actually is HTTPS.
  // req.secure honors X-Forwarded-Proto via the configured trust proxy, so a
  // TLS-terminating proxy still gets a Secure cookie; plain HTTP (LAN/Tailscale)
  // does not — a Secure cookie would be silently dropped by the browser.
  const isSecure = req.secure;
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? 'strict' : 'lax',
    maxAge: SESSION_DURATION_MS,
    path: '/',
  });
}

// Decide whether a still-valid session has aged enough to be worth re-issuing.
// Exported so the behaviour is testable without an express request in hand.
export function shouldRenewSession(expiresAt: string, now: number = Date.now()): boolean {
  const expiry = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiry)) return false;
  const spent = SESSION_DURATION_MS - (expiry - now);
  return spent >= SESSION_RENEW_AFTER_MS;
}

// Extends a live session in place and refreshes the browser cookie alongside
// it. The cookie matters as much as the row: without a new maxAge the browser
// would still drop it seven days after login however active the user had been.
function renewSessionIfStale(req: Request, res: Response, session: WebSession): void {
  const now = Date.now();
  if (!shouldRenewSession(session.expires_at, now)) return;
  touchWebSession(session.token, new Date(now + SESSION_DURATION_MS).toISOString());
  setSessionCookie(req, res, session.token);
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const config = getAerieConfig();
  if (!config.auth.password) {
    next();
    return;
  }

  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const cookies = parseCookie(cookieHeader);
  const sessionToken = cookies[COOKIE_NAME];

  if (!sessionToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const session = getWebSession(sessionToken);
  if (!session) {
    res.status(401).json({ error: 'Invalid session' });
    return;
  }

  if (new Date(session.expires_at) < new Date()) {
    res.status(401).json({ error: 'Session expired' });
    return;
  }

  renewSessionIfStale(req, res, session);

  next();
}

export function loginHandler(req: Request, res: Response): void {
  const config = getAerieConfig();
  if (!config.auth.password) {
    res.status(500).json({ error: 'Authentication not configured' });
    return;
  }

  const { password } = req.body ?? {};
  // A password is a short string or nothing. An object with a huge `length`
  // made Buffer.from build a gigabyte array before any comparison (security
  // audit, Nov 6 2026), so anything else is turned away before it is touched.
  if (typeof password !== 'string' || !password || password.length > 1024) {
    res.status(400).json({ error: 'Password required' });
    return;
  }

  const inputBuffer = Buffer.from(password);
  const expectedBuffer = Buffer.from(config.auth.password);

  const maxLen = Math.max(inputBuffer.length, expectedBuffer.length);
  const paddedInput = Buffer.alloc(maxLen);
  const paddedExpected = Buffer.alloc(maxLen);
  inputBuffer.copy(paddedInput);
  expectedBuffer.copy(paddedExpected);

  const isValid = crypto.timingSafeEqual(paddedInput, paddedExpected) &&
                  inputBuffer.length === expectedBuffer.length;

  if (!isValid) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  deleteExpiredSessions();

  const sessionToken = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

  createWebSession({
    id: crypto.randomUUID(),
    token: sessionToken,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  setSessionCookie(req, res, sessionToken);

  res.json({ success: true });
}

export function logoutHandler(req: Request, res: Response): void {
  // The row goes as well as the cookie: clearing the cookie only makes this
  // device forget the token, and a copy of it elsewhere would stay good.
  const cookieHeader = req.headers.cookie;
  const token = cookieHeader ? parseCookie(cookieHeader)[COOKIE_NAME] : undefined;
  if (token) deleteWebSession(token);
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'strict',
    path: '/',
  });
  res.json({ success: true });
}

export function sessionCheckHandler(req: Request, res: Response): void {
  const config = getAerieConfig();
  const authRequired = !!config.auth.password;
  if (!authRequired) {
    res.json({ authenticated: true, auth_required: false });
    return;
  }

  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    res.json({ authenticated: false });
    return;
  }

  const cookies = parseCookie(cookieHeader);
  const sessionToken = cookies[COOKIE_NAME];

  if (!sessionToken) {
    res.json({ authenticated: false });
    return;
  }

  const session = getWebSession(sessionToken);
  if (!session || new Date(session.expires_at) < new Date()) {
    res.json({ authenticated: false });
    return;
  }

  // The phone polls this on wake, so it is the one call a backgrounded app is
  // guaranteed to make. Renewing here is what keeps a quiet-but-open app alive.
  renewSessionIfStale(req, res, session);

  res.json({ authenticated: true });
}

/**
 * Whether a password change may go ahead (Nov 6 2026 audit). It needs the
 * current password, so a stolen session or a same-site request cannot change
 * it or blank it; the new one has to be a real string, since an empty password
 * turns the lock off after the next restart; and while APP_PASSWORD is set in
 * the environment it wins over the file anyway, so a change there would only
 * look like it worked.
 */
export function checkPasswordChange(
  current: unknown,
  next: unknown,
  configured: string,
  envOverride: boolean,
): { ok: true } | { ok: false; status: number; error: string } {
  if (envOverride) return { ok: false, status: 409, error: 'The password is set by APP_PASSWORD in the server environment; change it there.' };
  if (typeof next !== 'string' || !next.trim() || next.length > 1024) return { ok: false, status: 400, error: 'A new password is required.' };
  if (configured) {
    if (typeof current !== 'string' || current.length > 1024) return { ok: false, status: 403, error: 'Enter your current password to change it.' };
    const a = Buffer.from(current);
    const b = Buffer.from(configured);
    const len = Math.max(a.length, b.length);
    const pa = Buffer.alloc(len); const pb = Buffer.alloc(len);
    a.copy(pa); b.copy(pb);
    if (!(crypto.timingSafeEqual(pa, pb) && a.length === b.length)) return { ok: false, status: 403, error: 'Current password is not right.' };
  }
  return { ok: true };
}
