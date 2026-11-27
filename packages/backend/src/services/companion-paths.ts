// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A companion's identity file and MCP file are read into every turn of his
// lane, so the paths a request may set are kept inside the house: a
// markdown file for the identity, a JSON file for the servers, both under
// the house's own folder after any link is followed. Without this, anybody
// signed in could point a companion at any file on the box and have its
// contents read into a prompt (outside review, Nov 20 2026; done Nov 24 2026).

import { existsSync, realpathSync } from 'fs';
import { dirname, isAbsolute, resolve, sep, extname } from 'path';

/**
 * Why a companion file path is refused, or null when it is allowed. kind is
 * 'identity' (a .md file) or 'mcp' (a .json file); root is the house folder.
 */
export function companionPathRefusal(path: unknown, kind: 'identity' | 'mcp', root: string): string | null {
  if (path === undefined) return null;
  if (typeof path !== 'string' || !path.trim()) return `${kind === 'identity' ? 'claudeMdPath' : 'mcpJsonPath'} must be a file path`;
  const wanted = kind === 'identity' ? '.md' : '.json';
  let absolute = isAbsolute(path) ? resolve(path) : resolve(root, path);
  if (extname(absolute).toLowerCase() !== wanted) return `a companion's ${kind === 'identity' ? 'identity file must be a .md file' : 'MCP file must be a .json file'}`;
  // Inside the house by its name first, before anything on disk is touched
  // with it (code scanning, Nov 24 2026: the request's path reached the file
  // checks before the folder check), then again after links are followed.
  const lexicalHome = resolve(root);
  let home: string;
  try { home = realpathSync(root); } catch { home = lexicalHome; }
  // A path written through the real folder is read as the same path through
  // the house's own name, so one plain guard covers both (code scanning reads
  // a single startsWith as the check; it did not see the two-part one).
  if (home !== lexicalHome && absolute.startsWith(home + sep)) absolute = lexicalHome + absolute.slice(home.length);
  if (!absolute.startsWith(lexicalHome + sep)) return 'a companion file must live inside the house folder';
  // Where the path really lands once links are followed: the file itself if
  // it exists, else its folder plus its name. Inline, after the guard above,
  // so code scanning sees the check before the disk is touched (#95, #96).
  let where: string | null = null;
  try {
    if (existsSync(absolute)) where = realpathSync(absolute);
    else {
      const dir = dirname(absolute);
      if (existsSync(dir)) where = resolve(realpathSync(dir), absolute.slice(dir.length + 1));
    }
  } catch { where = null; }
  if (!where || !where.startsWith(home + sep)) return 'a companion file must live inside the house folder';
  return null;
}
