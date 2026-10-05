// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import React from 'react';
import ReactDOM from 'react-dom/client';
import { PetApp } from './components/PetApp';
import { THEMES } from './lib/theme';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div
      className="relative h-[100svh] overflow-hidden bg-[#090807]"
      style={{
        '--sat': '0px',
        '--sab': '0px',
        '--aerie-accent': '#a3e635',
        '--aerie-page': '#090807',
        '--aerie-surface': 'rgba(13, 11, 10, 0.68)',
        '--aerie-surface-strong': 'rgba(13, 11, 10, 0.86)',
        '--aerie-hairline': 'rgba(255, 255, 255, 0.16)',
        '--aerie-icon': 'rgba(255, 250, 245, 0.9)',
        '--aerie-label': 'rgba(255, 247, 237, 0.82)',
      } as React.CSSProperties}
    >
      <PetApp
        onClose={() => window.history.back()}
        themeConfig={THEMES.cobalt}
        themeMode="dark"
      />
    </div>
  </React.StrictMode>,
);
