// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { useState } from 'react';
import { FileText } from 'lucide-react';
import { apiFetch } from '../aerie';
import { copyToClipboard } from '../lib/clipboard';
import { saveToDevice } from '../lib/download';

/**
 * A link in a message that points at something this house is serving. Nothing
 * in here navigates — readable text opens IN the bubble, and anything else
 * goes out through saveToDevice, which asks the server for a
 * Content-Disposition header and lets the shell's download listener take it.
 * Why that matters is written where the classifying happens: lib/message-links.
 */
export const HouseFileLink = ({ href, label, textish }: { href: string; label: string; textish: boolean }) => {
  const [body, setBody] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'error'>('idle');
  const [copied, setCopied] = useState(false);
  const MAX = 400_000;

  const openIt = async () => {
    if (!textish) { saveToDevice(href); return; }
    if (body !== null) { setBody(null); return; }
    setPhase('loading');
    try {
      const res = await apiFetch(href);
      if (!res.ok) throw new Error(String(res.status));
      const text = await res.text();
      setBody(text.length > MAX ? `${text.slice(0, MAX)}\n\n… truncated here. Save it to read the rest.` : text);
      setPhase('idle');
    } catch {
      setPhase('error');
    }
  };

  return (
    <span className="inline-block w-full">
      <button
        type="button"
        onClick={openIt}
        className="inline-flex max-w-full items-baseline gap-1.5 text-left underline underline-offset-2 active:opacity-60"
      >
        <FileText size={13} className="shrink-0 opacity-70" />
        <span className="break-all">{label}</span>
      </button>
      {phase === 'loading' && <span className="ml-1.5 text-[11px] opacity-60">opening…</span>}
      {phase === 'error' && (
        <span className="ml-1.5 text-[11px] opacity-70">
          couldn’t read it —{' '}
          <button type="button" className="underline" onClick={() => saveToDevice(href)}>save it instead</button>
        </span>
      )}
      {body !== null && (
        <span className="mt-2 block rounded-lg border border-white/10 bg-black/20">
          <span className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] opacity-70">
            <span className="truncate">{label}</span>
            <span className="flex shrink-0 items-center gap-2">
              <button type="button" className="underline" onClick={async () => setCopied(await copyToClipboard(body))}>
                {copied ? 'copied' : 'copy'}
              </button>
              <button type="button" className="underline" onClick={() => saveToDevice(href)}>save</button>
              <button type="button" className="underline" onClick={() => setBody(null)}>close</button>
            </span>
          </span>
          <span className="block max-h-[320px] overflow-auto whitespace-pre-wrap break-words px-2.5 pb-2.5 font-mono text-[11px] leading-snug">
            {body}
          </span>
        </span>
      )}
    </span>
  );
};
