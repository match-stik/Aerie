// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AerieProvider} from './aerie';
import {AppErrorBoundary} from './components/AppErrorBoundary';
import './index.css';

// Excalidraw is lazy-loaded by The Press. Set its self-hosted font root before
// that chunk can evaluate so no editor asset ever falls back to a CDN.
(window as typeof window & {EXCALIDRAW_ASSET_PATH?: string}).EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AerieProvider>
        <App />
      </AerieProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
