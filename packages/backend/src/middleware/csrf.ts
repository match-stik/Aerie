// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { Request, Response, NextFunction } from 'express';
import { parse as parseCookie } from 'cookie';
import crypto from 'crypto';

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
