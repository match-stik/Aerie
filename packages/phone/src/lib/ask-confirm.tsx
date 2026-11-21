// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * The house's own "are you sure", in place of the browser's confirm().
 *
 * window.confirm draws the system's grey box: Windows' on the laptop app, a
 * WebView alert on the phone, with the app's name as its title and nothing of
 * the house in it. This asks the same question
 * in a small card in the house's own colors, answers a promise, and leaves
 * nothing behind: Escape or a tap outside is no, Enter is yes.
 */
import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

interface AskOptions {
  /** The yes button's word; Delete when not given. */
  yes?: string;
  /** The no button's word; Cancel when not given. */
  no?: string;
  /** A yes that is not destructive gets the accent instead of red. */
  gentle?: boolean;
}

function AskCard({ message, opts, answer }: { message: string; opts: AskOptions; answer: (yes: boolean) => void }) {
  const yesRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    yesRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); answer(false); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); answer(true); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [answer]);
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-6"
      onClick={() => answer(false)}
      style={{ fontFamily: 'var(--font-body, inherit)' }}
    >
      <div
        role="alertdialog"
        aria-label={message}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[360px] rounded-2xl p-5 shadow-2xl"
        style={{
          background: 'color-mix(in srgb, var(--aerie-page) 92%, var(--aerie-accent))',
          border: '1px solid var(--aerie-hairline)',
          color: 'var(--aerie-text)',
        }}
      >
        <p className="text-sm leading-relaxed">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => answer(false)}
            className="rounded-xl px-4 py-2 text-xs font-semibold"
            style={{ border: '1px solid var(--aerie-hairline)', color: 'var(--aerie-text-muted)' }}
          >
            {opts.no ?? 'Cancel'}
          </button>
          <button
            ref={yesRef}
            type="button"
            onClick={() => answer(true)}
            className="rounded-xl px-4 py-2 text-xs font-semibold outline-none"
            style={opts.gentle
              ? { background: 'var(--aerie-selected-fill, var(--aerie-accent))', color: 'var(--aerie-on-accent)' }
              : { background: 'rgba(220, 38, 38, 0.85)', color: '#fff' }}
          >
            {opts.yes ?? 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Ask, in the house's own card; true is yes. */
export function askConfirm(message: string, opts: AskOptions = {}): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let done = false;
    const answer = (yes: boolean) => {
      if (done) return;
      done = true;
      resolve(yes);
      // Let the click that answered finish before the card goes.
      setTimeout(() => { root.unmount(); host.remove(); }, 0);
    };
    root.render(<AskCard message={message} opts={opts} answer={answer} />);
  });
}
