// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// Derive project root for path containment (dist/routes/internal, five up).
const here = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(here, '..', '..', '..', '..', '..');

export function isPathAllowed(filePath: string): boolean {
  if (filePath.includes('\0')) return false;
  const resolvedPath = resolve(filePath);
  const safePrefixes = [PROJECT_ROOT, resolve(PROJECT_ROOT, '..')];
  return safePrefixes.some(prefix => resolvedPath.startsWith(prefix + '/') || resolvedPath.startsWith(prefix + '\\'));
}

// Whether a request came over the loopback socket. Every internal route checks it.
export function isLocalhost(req: { socket: { remoteAddress?: string } }): boolean {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
