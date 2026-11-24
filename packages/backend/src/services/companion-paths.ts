// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A companion's identity file and MCP file are read into every turn of his
// lane, so the paths a request may set are kept inside the house: a
// markdown file for the identity, a JSON file for the servers, both under
// the house's own folder after any link is followed. Without this, anybody
// signed in could point a companion at any file on the box and have its
// contents read into a prompt (outside review, Nov 20 2026; done Nov 24 2026).

import { existsSync, realpathSync } from 'fs';
import { dirname, isAbsolute, resolve, sep, extname } from 'path';

/** Where a path really lands: the file itself if it exists, else its folder plus its name. */
function landing(path: string): string | null {
  try {
    if (existsSync(path)) return realpathSync(path);
    const dir = dirname(path);
    if (!existsSync(dir)) return null;
    return resolve(realpathSync(dir), path.slice(dir.length + 1));
  } catch {
    return null;
  }
}

/**
 * Why a companion file path is refused, or null when it is allowed. kind is
 * 'identity' (a .md file) or 'mcp' (a .json file); root is the house folder.
 */
export function companionPathRefusal(path: unknown, kind: 'identity' | 'mcp', root: string): string | null {
  if (path === undefined) return null;
  if (typeof path !== 'string' || !path.trim()) return `${kind === 'identity' ? 'claudeMdPath' : 'mcpJsonPath'} must be a file path`;
  const wanted = kind === 'identity' ? '.md' : '.json';
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  if (extname(absolute).toLowerCase() !== wanted) return `a companion's ${kind === 'identity' ? 'identity file must be a .md file' : 'MCP file must be a .json file'}`;
  const where = landing(absolute);
  let home: string;
  try { home = realpathSync(root); } catch { home = resolve(root); }
  if (!where || (where !== home && !where.startsWith(home + sep))) return 'a companion file must live inside the house folder';
  return null;
}
