// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The net under the whole app.
//
// Without it a render error unmounts everything and leaves a black screen
// with no trace: the only way back is closing and reopening the app, and the
// cause has to be found by reading code. Now
// the fall shows a small card with a way back, and the house is told what
// broke (POST /api/client-errors, read as [client-error] in the error log).

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { apiFetch } from '../aerie';
import { clientErrorReport, shouldReport } from '../lib/client-error';

const sent = new Set<string>();

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const report = clientErrorReport(error, info.componentStack, window.location.pathname + window.location.hash);
    if (!shouldReport(report.message, sent)) return;
    void apiFetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    }).catch(() => {
      // Offline, or the house is down. The card still gives the owner a way back.
    });
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    // Painted from the theme's own variables with plain fallbacks, because the
    // thing that fell over may be the theme.
    return (
      <div
        role="alert"
        className="fixed inset-0 flex items-center justify-center p-6"
        style={{ background: 'var(--aerie-page, #0b0a09)', color: 'var(--aerie-text, #ece6dc)' }}
      >
        <div
          className="w-full max-w-xs rounded-2xl border p-5 text-center"
          style={{ background: 'var(--aerie-surface, rgba(255,255,255,0.04))', borderColor: 'color-mix(in oklch, var(--aerie-text, #ece6dc) 14%, transparent)' }}
        >
          <p className="text-sm font-semibold">Something on this screen fell over.</p>
          <p className="mt-1.5 text-xs" style={{ color: 'var(--aerie-text-muted, #a59d92)' }}>
            Nothing is lost. Reloading brings the house back.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-xl border px-3 py-2 text-xs"
              style={{ borderColor: 'color-mix(in oklch, var(--aerie-text, #ece6dc) 20%, transparent)' }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-xl px-3 py-2 text-xs font-semibold"
              style={{ background: 'var(--aerie-accent, #e85d04)', color: 'var(--aerie-on-accent, #090807)' }}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
