// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// What the house page can ask of the laptop app, and nothing more: wake
// Spotify on this computer, bring the window forward, say its version, start
// with Windows, fetch and run the house's newer installer, and (on the
// first-run page) set the house's address. The page finds it as window.aerieDesktop (aerie/spotify-wake.ts).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aerieDesktop', {
  platform: process.platform,
  wakeSpotify: () => ipcRenderer.invoke('aerie:wake-spotify'),
  setHouse: (url) => ipcRenderer.invoke('aerie:set-house', String(url ?? '')),
  show: () => ipcRenderer.invoke('aerie:show'),
  about: () => ipcRenderer.invoke('aerie:about'),
  setStartWithWindows: (on) => ipcRenderer.invoke('aerie:start-with-windows', Boolean(on)),
  checkUpdate: () => ipcRenderer.invoke('aerie:check-update'),
  installUpdate: () => ipcRenderer.invoke('aerie:install-update'),
});
