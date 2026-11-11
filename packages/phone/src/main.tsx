// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AerieProvider} from './aerie';
import {AppErrorBoundary} from './components/AppErrorBoundary';
import {reloadForStaleChunk} from './lib/stale-build';
import './index.css';

// Excalidraw is lazy-loaded by The Press. Set its self-hosted font root before
// that chunk can evaluate so no editor asset ever falls back to a CDN.
(window as typeof window & {EXCALIDRAW_ASSET_PATH?: string}).EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';

// A chunk renamed by a rebuild since this page loaded: fetch the new index once.
window.addEventListener('vite:preloadError', (event) => {
  const err = (event as Event & {payload?: unknown}).payload;
  if (reloadForStaleChunk(err instanceof Error ? err.message : String(err ?? ''))) event.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AerieProvider>
        <App />
      </AerieProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
