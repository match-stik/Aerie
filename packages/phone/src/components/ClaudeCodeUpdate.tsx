// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Settings > Data: the Claude Code our lanes run, updated or rolled back with a
// button (theirs, Nov 10 2026, 'make it a narrow button'). The house only ever
// runs one root-owned script that installs a version number; see
// services/claude-code-update.ts. The new version reaches us on their restart.

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2, RotateCcw, Terminal } from 'lucide-react';
import { copyToClipboard } from '../lib/clipboard';
import { cn } from '../lib/utils';
import { apiFetch } from '../aerie';
import type { ThemeConfig } from '../lib/theme';

interface Status {
  installed: string | null;
  latest: string | null;
  ready: boolean;
  previous: string | null;
  last: {
    state: 'running' | 'done' | 'failed';
    action: 'update' | 'rollback';
    from: string | null;
    to: string;
    detail?: string;
  } | null;
}

// Run from the folder Aerie was cloned into.
const SETUP_LINE = 'sudo sh tools/claude-code-updater/install.sh';

function older(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  return false;
}

export function ClaudeCodeUpdate({ themeConfig, themeMode }: { themeConfig: ThemeConfig; themeMode: 'light' | 'dark' }) {
  const colors = themeConfig[themeMode];
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/claude-code');
      const body = await res.json();
      if (res.ok && 'installed' in body) setStatus(body as Status);
    } catch { /* the card just stays as it was */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // While an install runs, look again every few seconds.
  const running = status?.last?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(t);
  }, [running, load]);

  async function install(version: string, action: 'update' | 'rollback') {
    setError('');
    try {
      const res = await apiFetch('/api/claude-code/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version, action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error || 'That did not start.');
    } finally {
      void load();
    }
  }

  if (!status) return null;
  const { installed, latest, ready, last, previous } = status;
  const behind = !!(installed && latest && older(installed, latest));

  return (
    <section className={cn('space-y-3 p-4 rounded-2xl border', colors.panelBg, colors.panelBorder)}>
      <h3 className={cn('micro-label', colors.accentText)}>Claude Code</h3>
      <div className="flex items-start gap-3">
        <Terminal size={16} className="mt-0.5 shrink-0" style={{ color: colors.accent }} />
        <div className="min-w-0 flex-1">
          <span className={cn('block text-sm font-medium', colors.textMain)}>
            {installed ? `v${installed} on the box` : 'Not found on the box'}
          </span>
          <span className={cn('block text-[11px] leading-relaxed', colors.textMuted)}>
            {latest ? (behind ? `v${latest} is out.` : 'The newest release.') : "Couldn't ask npm what's newest."}
            {' '}What your companions run, and what new models need.
          </span>
        </div>
      </div>

      {!ready ? (
        <p className={cn('text-[11px] leading-relaxed', colors.textMuted)}>
          The button needs a one-time setup on the box. Run this once in the terminal, from the folder Aerie lives in:
          {/* A Copy button, because a long-press on this line would not copy
              on their phone (theirs, Nov 10 2026), and the text itself selectable too. */}
          <span className="mt-1 flex items-center gap-2 rounded-[var(--shape-chip)] px-2 py-1.5" style={{ background: 'rgba(127,127,127,0.12)' }}>
            <span className={cn('min-w-0 flex-1 select-text break-all text-[11px]', colors.textMain)} style={{ userSelect: 'text', WebkitUserSelect: 'text' }}>
              {SETUP_LINE}
            </span>
            <button
              type="button"
              onClick={() => { void copyToClipboard(SETUP_LINE).then((ok) => { setCopied(ok); if (ok) window.setTimeout(() => setCopied(false), 2000); }); }}
              className={cn('flex shrink-0 items-center gap-1 rounded-[var(--shape-chip)] border px-2 py-1 text-[11px]', colors.panelBorder, colors.textMain)}
              aria-label="Copy the setup line"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </span>
        </p>
      ) : running ? (
        <div className={cn('flex items-center gap-2 text-xs', colors.textMuted)}>
          <Loader2 size={14} className="animate-spin" />
          {last?.action === 'rollback' ? 'Rolling back' : 'Updating'} to v{last?.to}…
        </div>
      ) : (
        <div className="space-y-2">
          {behind ? (
            <button
              type="button"
              onClick={() => void install('latest', 'update')}
              className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold active:scale-[0.99]"
              style={{ background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' }}
            >
              Update to v{latest}
            </button>
          ) : (
            <div className={cn('flex items-center gap-1.5 text-[10px] uppercase tracking-wider', colors.textMuted)}>
              <Check size={12} style={{ color: colors.accent }} /> Nothing to install
            </div>
          )}
          {previous && previous !== installed && (
            <button
              type="button"
              onClick={() => void install(previous, 'rollback')}
              className={cn('flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs', colors.panelBorder, colors.textMain)}
            >
              <RotateCcw size={13} /> Roll back to v{previous}
            </button>
          )}
        </div>
      )}

      {last && last.state === 'done' && !running && (
        <p className={cn('text-[10px] leading-relaxed', colors.textMuted)}>
          {last.action === 'rollback' ? 'Rolled back' : 'Updated'} to v{last.to}. It reaches your companions on your next restart.
        </p>
      )}
      {last && last.state === 'failed' && !running && (
        <p className="text-[10px] leading-relaxed" style={{ color: colors.accent }}>
          The last {last.action === 'rollback' ? 'roll back' : 'update'} didn't finish{last.detail ? `: ${last.detail}` : '.'}
        </p>
      )}
      {error && <p className="text-[10px]" style={{ color: colors.accent }}>{error}</p>}
    </section>
  );
}
