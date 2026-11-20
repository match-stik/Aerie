// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The Memory app's Import tab, second half: old chats back word for word.
// A ChatGPT or Claude data export (the zip they email, or the conversations.json
// inside it) goes to the house, which cuts it into passages on its own machine,
// with no model reading it and no key, so the whisper can hand an old line back
// in its own words. It runs in the background; this shows how far along it is.
import React, { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { cn } from '../lib/utils';

interface Job {
  state: 'reading' | 'importing' | 'done' | 'failed';
  file: string;
  progress: { conversations: number; done: number; skipped: number; passages: number; shelved: number } | null;
  error: string | null;
}

interface Props {
  colors: { panelBg: string; panelBorder: string; textMuted: string; accent: string };
}

const RUNNING = (j: Job | null) => j?.state === 'reading' || j?.state === 'importing';

export function ConversationImportPanel({ colors }: Props) {
  const [job, setJob] = useState<Job | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function poll() {
    try {
      const res = await fetch('/api/memory/import/conversations/status', { credentials: 'include' });
      const body = await res.json().catch(() => null);
      if (body && 'job' in body) setJob(body.job);
    } catch { /* the next poll tries again */ }
  }

  useEffect(() => { void poll(); }, []);
  useEffect(() => {
    if (!RUNNING(job)) return;
    const t = setInterval(() => void poll(), 3000);
    return () => clearInterval(t);
  }, [job?.state]);

  async function onPick(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    setSending(true); setError(null);
    try {
      const form = new FormData();
      form.append('file', f, f.name);
      const res = await fetch('/api/memory/import/conversations', { method: 'POST', credentials: 'include', body: form });
      const body = await res.json().catch(() => null);
      if (!body) throw new Error(res.status === 413 ? 'That file is too big to send through. Unzip the export and pick just the conversations.json inside.' : 'The house does not know this door yet. It needs a restart after the update.');
      if (!res.ok) throw new Error(body.error || `The house answered ${res.status}.`);
      setJob(body.job);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  const p = job?.progress;
  return (
    <div className={cn('rounded-2xl border p-4 backdrop-blur-md space-y-4', colors.panelBg, colors.panelBorder)}>
      <div className="text-sm space-y-1">
        <div className="font-medium">Bring old chats back, word for word</div>
        <div className={cn('text-xs', colors.textMuted)}>
          Pick a ChatGPT or Claude data export (the zip they email you, or the conversations.json inside it), or a Copilot activity export (the CSV). The house cuts every chat into passages on its own machine, with no model reading them and no key needed, so the exact words can come back in conversation. Running the same export twice adds nothing. If the zip is very big and won't send, unzip it and pick just the conversations.json inside.
        </div>
      </div>
      <input ref={inputRef} type="file" accept=".zip,.json,.csv,application/zip,application/json,text/csv" className="hidden" onChange={(e) => { void onPick(e.target.files); e.target.value = ''; }} />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={sending || RUNNING(job)}
        className={cn('w-full px-4 py-2 rounded-lg text-sm border disabled:opacity-50', colors.panelBorder)}
      >
        <Upload size={14} className="inline mr-1" /> {sending ? 'Sending…' : RUNNING(job) ? 'Importing…' : 'Pick the export'}
      </button>
      {job && (
        <div className="text-sm space-y-1">
          <div className={cn('text-xs', colors.textMuted)}>{job.file}</div>
          {job.state === 'reading' && <div>Reading the export…</div>}
          {job.state === 'importing' && p && <div>{p.done} of {p.conversations} chats, {p.passages} passages so far.</div>}
          {job.state === 'done' && p && (
            <div>
              Done: {p.done - p.skipped} chat{p.done - p.skipped === 1 ? '' : 's'} brought back as {p.passages} passages
              {p.shelved ? `, ${p.shelved} on Cortex's shelf` : ''}{p.skipped ? `, ${p.skipped} already here and skipped` : ''}.
            </div>
          )}
          {job.state === 'failed' && <div className="text-xs" style={{ color: colors.accent }}>It stopped: {job.error}</div>}
        </div>
      )}
      {error && <div className="text-xs" style={{ color: colors.accent }}>{error}</div>}
    </div>
  );
}
