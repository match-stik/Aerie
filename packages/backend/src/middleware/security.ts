// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
export const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: true },
});
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  validate: { trustProxy: true },
});
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // (self) so same-origin pages can call these APIs after a normal
  // browser prompt; () would be a hard policy-level block that silently
  // denies before the user is even asked. WeatherApp needs geolocation,
  // mic recorder needs microphone, future contact-photo capture could
  // need camera.
  res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(self), camera=(self)');
  next();
}
