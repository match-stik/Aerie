// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// What the export button asks before it downloads (theirs, Oct 31 2026): words
// only or words with every picture as a zip, and the whole thread or a date
// range. The house builds the file (GET /api/threads/:id/export); this only
// chooses, then hands the address to the same save path the rest of the app
// uses, so the Android app's download listener saves it.
import { useState } from 'react';
import { X } from 'lucide-react';
import { saveHref } from '../lib/download';

type Range = 'all' | 'month' | 'pick';

function monthStart(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function today(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function exportUrl(threadId: string, zip: boolean, from?: string, to?: string): string {
  const q = new URLSearchParams();
  if (zip) q.set('format', 'zip');
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const qs = q.toString();
  return `/api/threads/${encodeURIComponent(threadId)}/export${qs ? `?${qs}` : ''}`;
}

export function ExportSheet({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const [zip, setZip] = useState(false);
  const [range, setRange] = useState<Range>('month');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());

  const go = () => {
    const dates = range === 'all' ? {} : range === 'month' ? { from: monthStart(), to: today() } : { from, to };
    const a = document.createElement('a');
    a.href = saveHref(exportUrl(threadId, zip, dates.from, dates.to));
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    onClose();
  };

  const choice = (on: boolean) =>
    `flex-1 px-3 py-2 text-sm rounded-[var(--shape-control)] border transition-colors ${on ? 'font-semibold' : 'opacity-70'}`;
  const choiceStyle = (on: boolean) => ({
    borderColor: on ? 'var(--aerie-accent)' : 'color-mix(in srgb, var(--aerie-text, #fff) 20%, transparent)',
    color: on ? 'var(--aerie-accent)' : undefined,
  });

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md m-3 p-4 space-y-4 rounded-[var(--shape-surface)] border bg-[var(--pal-surface,#151014)]"
        style={{ borderColor: 'color-mix(in srgb, var(--aerie-accent) 30%, transparent)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-base font-semibold">Export this thread</span>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 opacity-70"><X size={18} /></button>
        </div>
        <div className="space-y-2">
          <span className="text-xs opacity-70">What to include</span>
          <div className="flex gap-2">
            <button type="button" className={choice(!zip)} style={choiceStyle(!zip)} onClick={() => setZip(false)}>Words only</button>
            <button type="button" className={choice(zip)} style={choiceStyle(zip)} onClick={() => setZip(true)}>Words and pictures (zip)</button>
          </div>
        </div>
        <div className="space-y-2">
          <span className="text-xs opacity-70">Which messages</span>
          <div className="flex gap-2">
            <button type="button" className={choice(range === 'month')} style={choiceStyle(range === 'month')} onClick={() => setRange('month')}>This month</button>
            <button type="button" className={choice(range === 'pick')} style={choiceStyle(range === 'pick')} onClick={() => setRange('pick')}>Pick dates</button>
            <button type="button" className={choice(range === 'all')} style={choiceStyle(range === 'all')} onClick={() => setRange('all')}>All of it</button>
          </div>
          {range === 'pick' && (
            <div className="flex gap-2 items-center text-sm">
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="flex-1 px-2 py-1.5 rounded-[var(--shape-control)] bg-transparent border border-white/20" />
              <span className="opacity-60">to</span>
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="flex-1 px-2 py-1.5 rounded-[var(--shape-control)] bg-transparent border border-white/20" />
            </div>
          )}
          {zip && range === 'all' && (
            <p className="text-xs opacity-70">Every picture in a long thread can come to gigabytes. A date range keeps it a size a phone can hold.</p>
          )}
        </div>
        <button
          type="button"
          onClick={go}
          className="w-full py-2.5 rounded-[var(--shape-control)] font-semibold"
          style={{ background: 'var(--aerie-accent)', color: 'var(--aerie-on-accent, #090807)' }}
        >
          Download
        </button>
      </div>
    </div>
  );
}
