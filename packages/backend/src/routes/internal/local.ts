// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { realpathSync } from 'fs';
import { basename, dirname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { getConfig } from '../../services/db/config.js';

// Derive project root for path containment (dist/routes/internal, five up).
const here = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(here, '..', '..', '..', '..', '..');

// The loopback doors that read a file a lane names (share, attach, canvas,
// subtitles, thresholds) read inside the house's own folder, plus any folder
// the house lists in files.share_roots (a JSON list of absolute paths). They
// used to allow the folder above the house too, which is usually the whole
// home folder, and the share door copies into the store /api/files serves;
// so a lane talked into it could publish ~/.codex/auth.json (fourth outside
// audit, Nov 20 2026). Now: links are followed to where they really point
// before the check, nothing hidden (no path part starting with a dot: .ssh,
// .codex, .claude, .git) and no settings file or database is ever readable
// through them, whatever folder is listed.
function realOrResolved(p: string): string {
  try { return realpathSync(p); } catch { return resolve(p); }
}

function configuredShareRoots(): string[] {
  try {
    const raw = getConfig('files.share_roots');
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string' && v.startsWith('/')) : [];
  } catch {
    return [];
  }
}

// The settings, the databases and any session file are never handed out,
// judged on the last part of the path by plain checks: the one pattern this
// replaced could backtrack for a long time on a crafted name.
function isNeverFile(real: string): boolean {
  const name = basename(real).toLowerCase();
  if (name === 'aerie.yaml' || name === 'aerie.yml') return true;
  if (/\.db(-wal|-shm|-journal)?$/.test(name) && name.length > 3) return true;
  return name.endsWith('.json') && name.includes('session');
}

export function isPathAllowedWith(filePath: string, roots: ReadonlyArray<string>): boolean {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) return false;
  const real = realOrResolved(filePath);
  if (isNeverFile(real)) return false;
  return roots.some((root) => {
    const r = realOrResolved(root);
    if (real !== r && !real.startsWith(r + sep)) return false;
    const rest = real.slice(r.length).split(sep).filter(Boolean);
    return rest.length > 0 && !rest.some((part) => part.startsWith('.'));
  });
}

export function isPathAllowed(filePath: string): boolean {
  return isPathAllowedWith(filePath, [PROJECT_ROOT, ...configuredShareRoots()]);
}

// Whether a request came over the loopback socket. Every internal route checks it.
export function isLocalhost(req: { socket: { remoteAddress?: string } }): boolean {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
