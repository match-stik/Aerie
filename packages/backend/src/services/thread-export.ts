// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A whole thread as one text file, from the house (theirs, Oct 31 2026: the
// export button 'should do what it suggests'). The phone used to export only
// the messages it had loaded, the newest fifty plus whatever they had scrolled
// through. This reads every message the thread holds, oldest first, a page at
// a time so a thread of many thousands never sits in memory at once, and names
// each attachment with the address it can be fetched from.
import { getDb } from './db.js';
import { getCompanion } from './db/companions.js';
import { getFile } from './files.js';

interface Row {
  sequence: number;
  role: string;
  content: string;
  created_at: string;
  companion_id: string | null;
  metadata: string | null;
}

const PAGE = 500;

type Attachment = { fileId?: string; filename?: string; url?: string; contentType?: string };

/** A file a zip export carries: where it is on disk, and its name inside the zip. */
export interface ExportedFile { path: string; name: string }

function attachmentsOf(metadata: string | null): Attachment[] {
  if (!metadata) return [];
  try {
    return (JSON.parse(metadata) as { attachments?: Attachment[] }).attachments ?? [];
  } catch {
    return [];
  }
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'file';
}

/** Write the whole thread through `write`, oldest first. Answers how many messages. */
export function writeThreadExport(
  threadId: string,
  opts: {
    userName: string;
    companionsName: string;
    origin: string;
    /** Only messages on or after this ISO date or time. */
    from?: string;
    /** Only messages before the end of this ISO date or time. */
    to?: string;
    /** For a zip: called with each attachment found on disk; the text then
     *  names its place in the zip instead of a link. */
    onFile?: (file: ExportedFile) => void;
    /** Where an attachment lives on disk; the house's file store unless a test says otherwise. */
    resolveFile?: (fileId: string) => { path: string; filename: string } | null;
  },
  write: (chunk: string) => void,
): number {
  const db = getDb();
  const page = db.prepare(`
    SELECT sequence, role, content, created_at, companion_id, metadata
    FROM messages
    WHERE thread_id = ? AND deleted_at IS NULL AND sequence > ?
    ORDER BY sequence ASC
    LIMIT ?
  `);
  const names = new Map<string, string>();
  const nameOf = (id: string | null): string => {
    if (!id) return opts.companionsName;
    if (!names.has(id)) names.set(id, getCompanion(id)?.display_name || opts.companionsName);
    return names.get(id)!;
  };
  let after = -1;
  let count = 0;
  for (;;) {
    const rows = page.all(threadId, after, PAGE) as unknown as Row[];
    if (rows.length === 0) break;
    for (const r of rows) {
      if (opts.from && r.created_at < opts.from) continue;
      if (opts.to && r.created_at >= opts.to) continue;
      const who = r.role === 'user' ? opts.userName : r.role === 'system' ? 'House' : nameOf(r.companion_id);
      const when = new Date(r.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
      const lines = attachmentsOf(r.metadata).map((a) => {
        const kind = a.contentType === 'image' ? 'Picture' : 'File';
        const label = a.filename ?? 'attachment';
        if (opts.onFile && a.fileId) {
          const disk = (opts.resolveFile ?? getFile)(a.fileId);
          if (disk) {
            const name = `pictures/${r.sequence}-${safeName(a.filename ?? disk.filename)}`;
            opts.onFile({ path: disk.path, name });
            return `[${kind}: ${name}]`;
          }
        }
        const url = a.url ? (a.url.startsWith('/') ? opts.origin + a.url : a.url) : '';
        return `[${kind}: ${label}]${url ? ` ${url}` : ''}`;
      });
      const body = [r.content.trim(), ...lines].filter(Boolean).join('\n');
      write(`[${when}] ${who}:\n${body}\n\n`);
      count++;
    }
    after = rows[rows.length - 1].sequence;
    if (rows.length < PAGE) break;
  }
  return count;
}
