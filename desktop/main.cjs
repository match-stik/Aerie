// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Aerie on a laptop. The house in its own window, the same page the browser shows,
// plus the one thing a browser cannot do: start Spotify on this computer.
// Spotify only plays where it is already running, so a play with nowhere to
// go asks this app to open Spotify, and the house waits for the laptop to
// show up among their devices before pressing play again (the phone does the
// same with Spotify's kit, aerie/spotify-wake.ts).
//
// Which house: house.json beside this file ({"url": "https://..."}) when the
// app is built for one house, otherwise the address typed in on first run,
// kept in the app's own folder. Nothing about any house is written in here.

const { app, BrowserWindow, ipcMain, shell, session, Menu, Tray, nativeImage, net } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/** Windows ties notifications to this id; the installer's Start menu entry carries the same one. */
const APP_ID = 'com.aerie.desktop';

/** Read by the house to tell this app apart from a browser on the same laptop. */
const AGENT_MARK = `AerieDesktop/${app.getVersion()}`;

const configFile = () => path.join(app.getPath('userData'), 'config.json');
const windowFile = () => path.join(app.getPath('userData'), 'window.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  } catch {
    // A window that forgets its size is not worth stopping for.
  }
}

/** A house address that is only ever http(s), with nothing after the host. */
function cleanUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim().includes('://') ? value.trim() : `https://${value.trim()}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function houseUrl() {
  const built = readJson(path.join(__dirname, 'house.json'));
  return cleanUrl(built && built.url) || cleanUrl((readJson(configFile()) || {}).url);
}

// ---- waking Spotify ----

/** Where Spotify's own installer puts it on Windows; the Store copy has no fixed path and goes by its link instead. */
function windowsSpotifyPaths() {
  const out = [];
  if (process.env.APPDATA) out.push(path.join(process.env.APPDATA, 'Spotify', 'Spotify.exe'));
  if (process.env.LOCALAPPDATA) out.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'Spotify.exe'));
  return out;
}

function launch(file, args) {
  return new Promise((resolve) => {
    try {
      const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.once('error', () => resolve(false));
      child.once('spawn', () => { child.unref(); resolve(true); });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Start Spotify on this computer, minimized where it allows, so it signs in
 * and appears among their devices. Answers which road it took; the house then
 * watches their device list for this computer.
 */
async function wakeSpotify() {
  if (process.platform === 'win32') {
    for (const file of windowsSpotifyPaths()) {
      if (fs.existsSync(file) && await launch(file, ['--minimized'])) return { launched: true, road: 'exe' };
    }
  } else if (process.platform === 'darwin') {
    if (await launch('open', ['-g', '-a', 'Spotify'])) return { launched: true, road: 'open' };
  } else if (await launch('spotify', [])) {
    return { launched: true, road: 'exe' };
  }
  try {
    await shell.openExternal('spotify:');
    return { launched: true, road: 'link' };
  } catch {
    return { launched: false, road: 'none' };
  }
}

ipcMain.handle('aerie:wake-spotify', () => wakeSpotify());

ipcMain.handle('aerie:set-house', (_event, value) => {
  const url = cleanUrl(value);
  if (!url) return { ok: false };
  writeJson(configFile(), { url });
  const win = BrowserWindow.getAllWindows()[0];
  if (win) void win.loadURL(url);
  return { ok: true };
});

// ---- the window, the tray, and the app itself ----

let mainWindow = null;
let tray = null;
/** True once they chose Quit; until then closing the window only tucks it by the clock. */
let quitting = false;

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function makeTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 32, height: 32 }));
  tray.setToolTip('Aerie');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Aerie', click: showWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

ipcMain.handle('aerie:show', () => { showWindow(); return true; });

ipcMain.handle('aerie:about', () => ({
  version: app.getVersion(),
  startWithWindows: process.platform === 'win32' ? app.getLoginItemSettings().openAtLogin : null,
  lastUpdate,
}));

ipcMain.handle('aerie:start-with-windows', (_event, on) => {
  if (process.platform !== 'win32') return null;
  app.setLoginItemSettings({ openAtLogin: Boolean(on), args: ['--hidden'] });
  return app.getLoginItemSettings().openAtLogin;
});

/** Is the house holding a newer installer than this app? */
async function checkUpdate() {
  const house = houseUrl();
  if (!house) return { current: app.getVersion(), latest: null, newer: false };
  try {
    const res = await net.fetch(`${house}/api/app/desktop/version`, { session: session.defaultSession });
    const meta = res.ok ? await res.json() : null;
    const latest = meta && meta.available && typeof meta.version === 'string' ? meta.version : null;
    return { current: app.getVersion(), latest, newer: Boolean(latest) && newerThan(latest, app.getVersion()) };
  } catch {
    return { current: app.getVersion(), latest: null, newer: false };
  }
}

function newerThan(a, b) {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

ipcMain.handle('aerie:check-update', () => checkUpdate());

/**
 * Fetch the house's newer copy with their own sign-in and put it in place of
 * this one, with no script in between (an earlier PowerShell step could close
 * the app and leave nothing behind, not even its own log). This app downloads the zip into
 * its own folder, unpacks it with the tar.exe Windows ships, starts the new
 * copy from there with --aerie-finish-update, and quits. The new copy waits
 * for this one to close, copies itself over this folder with retries (Windows
 * will not overwrite a running exe, and Electron's helpers outlive the main
 * process by a moment), and opens the app again whatever happened, so a
 * failed update still leaves them the old one. Both halves write every step
 * into update.log beside the app's settings, before anything closes; the next
 * start reads it and Settings shows how it went.
 */
ipcMain.handle('aerie:install-update', async () => {
  const house = houseUrl();
  if (!house) return { ok: false, error: 'No house address.' };
  if (process.platform !== 'win32') return { ok: false, error: 'Updating from Settings is for Windows; rebuild the app here instead.' };
  const fail = (message) => { updateNote(`FAILED ${message}`); return { ok: false, error: message }; };
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(updateLogFile(), `${new Date().toISOString()} START from ${app.getVersion()}\r\n`);
    const res = await net.fetch(`${house}/api/app/desktop/download`, { session: session.defaultSession });
    if (!res.ok) return fail(`the house answered ${res.status}`);
    const work = updateWorkDir();
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    const zip = path.join(work, 'aerie.zip');
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    updateNote(`downloaded ${fs.statSync(zip).size} bytes`);
    const stage = path.join(work, 'app');
    fs.mkdirSync(stage, { recursive: true });
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    const unpacked = await runQuiet(tar, ['-xf', zip, '-C', stage]);
    if (unpacked.code !== 0) return fail(`unpacking (tar ${unpacked.code}): ${unpacked.err.trim().slice(0, 300)}`);
    const exeName = path.basename(process.execPath);
    const newExe = path.join(stage, exeName);
    if (!fs.existsSync(newExe)) return fail(`the zip has no ${exeName}`);
    fs.rmSync(zip, { force: true });
    updateNote('unpacked');
    const started = await launch(newExe, ['--aerie-finish-update', path.dirname(process.execPath), String(process.pid)]);
    if (!started) return fail('Windows would not start the new copy');
    updateNote('handed over to the new copy');
    quitting = true;
    setTimeout(() => app.quit(), 300);
    return { ok: true };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
});

function updateLogFile() {
  return path.join(app.getPath('userData'), 'update.log');
}

/** Where an update is downloaded and unpacked: the app's own folder, not Temp. */
function updateWorkDir() {
  return path.join(app.getPath('userData'), 'update');
}

function updateNote(message, file = updateLogFile()) {
  try { fs.appendFileSync(file, `${new Date().toISOString()} ${message}\r\n`); } catch { /* nowhere to say it */ }
}

/** Run a program to the end with no window, answering its exit code and what it said on stderr. */
function runQuiet(file, args) {
  return new Promise((resolve) => {
    let err = '';
    try {
      const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr.on('data', (chunk) => { err += chunk; });
      child.once('error', (e) => resolve({ code: -1, err: e.message }));
      child.once('close', (code) => resolve({ code: code ?? -1, err }));
    } catch (e) {
      resolve({ code: -1, err: e instanceof Error ? e.message : String(e) });
    }
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return Boolean(e && e.code === 'EPERM'); }
}

/**
 * The new copy's half, run instead of the app when started with
 * --aerie-finish-update <app folder> <old pid>: wait for the old app to close,
 * copy this folder over it, and open the app from its own folder again. It
 * never opens a window and never takes the one-window lock.
 */
async function finishUpdate(appDir, oldPid) {
  const log = updateLogFile();
  // Its own profile, so it never shares the app's open settings folder.
  try { app.setPath('userData', path.join(updateWorkDir(), 'profile')); } catch { /* keeps the default */ }
  const exe = path.join(appDir || '', path.basename(process.execPath));
  updateNote(`the new copy ${app.getVersion()} is running`, log);
  try {
    if (!appDir || !fs.existsSync(exe)) throw new Error(`no app at ${appDir}`);
    const waitUntil = Date.now() + 30_000;
    while (processAlive(oldPid) && Date.now() < waitUntil) await sleep(300);
    updateNote(processAlive(oldPid) ? 'the old app is still open after 30 s; copying anyway' : 'the old app has closed', log);
    const here = path.dirname(process.execPath);
    let lastError = null;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      try {
        fs.cpSync(here, appDir, { recursive: true, force: true });
        lastError = null;
        updateNote(`OK copied ${app.getVersion()} into place${attempt > 1 ? ` on try ${attempt}` : ''}`, log);
        break;
      } catch (error) {
        lastError = error;
        await sleep(1000);
      }
    }
    if (lastError) updateNote(`FAILED copying: ${lastError.message}`, log);
  } catch (error) {
    updateNote(`FAILED ${error instanceof Error ? error.message : String(error)}`, log);
  } finally {
    // Said before the launch: the reopened app reads this log as it starts.
    updateNote('reopening the app', log);
    const reopened = fs.existsSync(exe) ? await launch(exe, []) : false;
    if (!reopened) updateNote('FAILED reopening the app', log);
    app.exit(0);
  }
}

/**
 * How the last update went, read once at start from update.log and then
 * moved aside so it is reported once: null when there was no update.
 */
let lastUpdate = null;
function readLastUpdate() {
  try {
    const file = updateLogFile();
    if (!fs.existsSync(file)) return;
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    const end = [...lines].reverse().find((l) => / (OK|FAILED)\b/.test(l)) || null;
    const start = lines.find((l) => / START /.test(l)) || '';
    const last = lines.length ? lines[lines.length - 1].replace(/^\S+ /, '') : '';
    lastUpdate = {
      ok: Boolean(end && / OK\b/.test(end)),
      from: (start.match(/START from (\S+)/) || [])[1] || null,
      to: app.getVersion(),
      note: end ? end.replace(/^\S+ /, '') : `The updater stopped before it finished${last ? ` (the last step it wrote: ${last})` : ''}.`,
    };
    fs.renameSync(file, `${file}.prev`);
    reportUpdateLog(text);
  } catch {
    // Nothing to say about it.
  }
}

/** The whole log goes to the house's client-error lines too, so it can be read without them opening anything. */
function reportUpdateLog(text) {
  const house = houseUrl();
  if (!house || !lastUpdate) return;
  const body = {
    where: 'laptop-update-log',
    message: `${lastUpdate.from || '?'} to ${lastUpdate.to}: ${lastUpdate.ok ? 'OK' : lastUpdate.note}`,
    stack: text.slice(-2000),
    componentStack: '',
  };
  void net.fetch(`${house}/api/client-errors`, {
    method: 'POST',
    session: session.defaultSession,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

/**
 * Windows shows an app's notifications only when a Start menu shortcut with
 * the app's id points at it, which an installer would normally make; this
 * app comes as a zip, so it makes its own on every start (and a desktop one
 * the first time), pointing at wherever it was unzipped.
 */
function ensureShortcuts() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const icon = path.join(process.resourcesPath, 'icon.ico');
  const link = {
    target: process.execPath,
    appUserModelId: APP_ID,
    description: 'Aerie',
    ...(fs.existsSync(icon) ? { icon, iconIndex: 0 } : {}),
  };
  try {
    const startMenu = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Aerie.lnk');
    shell.writeShortcutLink(startMenu, fs.existsSync(startMenu) ? 'replace' : 'create', link);
    const marker = path.join(app.getPath('userData'), 'desktop-shortcut-made');
    if (!fs.existsSync(marker)) {
      shell.writeShortcutLink(path.join(app.getPath('desktop'), 'Aerie.lnk'), 'create', link);
      fs.writeFileSync(marker, new Date().toISOString());
    }
  } catch {
    // Without the shortcut they still have the app; only its notifications wait.
  }
  // A start-with-Windows entry names the exe's path, so a moved folder gets it refreshed.
  try {
    if (app.getLoginItemSettings().openAtLogin) app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
  } catch {
    // Left as it was.
  }
}

function createWindow() {
  const saved = readJson(windowFile()) || {};
  const win = new BrowserWindow({
    width: saved.width || 1280,
    height: saved.height || 800,
    x: saved.x,
    y: saved.y,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#090807',
    title: 'Aerie',
    icon: path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      // The conversation's socket keeps its heartbeat while the window is
      // tucked away, so a message can still reach them as a notification.
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  if (saved.maximized) win.maximize();

  const keep = () => {
    if (win.isDestroyed()) return;
    const bounds = win.getNormalBounds();
    writeJson(windowFile(), { ...bounds, maximized: win.isMaximized() });
  };
  win.on('resize', keep);
  win.on('move', keep);
  win.on('close', (event) => {
    keep();
    // Closing tucks it down by the clock, so the house can still reach them; Quit is
    // on the tray icon's menu.
    if (!quitting && tray) {
      event.preventDefault();
      win.hide();
    }
  });

  // F12 or Ctrl+Shift+I opens the inspector, so a thing that will not load
  // can be looked at from inside the app.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const inspector = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i');
    if (inspector) {
      event.preventDefault();
      win.webContents.toggleDevTools();
      return;
    }
    // F5 or Ctrl+R reloads, the way a browser does, so a house update reaches
    // the app without quitting it.
    if (input.key === 'F5' || (input.control && !input.shift && input.key.toLowerCase() === 'r')) {
      event.preventDefault();
      win.webContents.reload();
    }
  });

  const house = houseUrl();
  // Links out of the house open in their own browser; the house stays in here.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const here = houseUrl();
    if (url.startsWith('file:')) return;
    let origin = '';
    try { origin = new URL(url).origin; } catch { /* not an address */ }
    if (!here || origin !== here) {
      event.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });

  if (process.argv.includes('--hidden')) win.hide();
  if (house) void win.loadURL(house);
  else void win.loadFile(path.join(__dirname, 'setup.html'));
}

const finishAt = process.argv.indexOf('--aerie-finish-update');

if (finishAt !== -1) {
  // The new copy finishing an update: no window, no lock, just the copy.
  app.disableHardwareAcceleration();
  void finishUpdate(process.argv[finishAt + 1], Number(process.argv[finishAt + 2]));
} else if (!app.requestSingleInstanceLock()) {
  // One window: opening the app again brings the one already open forward.
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => { quitting = true; });
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

  app.userAgentFallback = `${app.userAgentFallback} ${AGENT_MARK}`;

  app.whenReady().then(() => {
    readLastUpdate();
    // The finished update's download, unpacked copy and the new copy's profile.
    setTimeout(() => { try { fs.rmSync(updateWorkDir(), { recursive: true, force: true }); } catch { /* next start */ } }, 15_000);
    Menu.setApplicationMenu(null);
    // The microphone (voice mode), notifications and the clipboard, for the
    // house only.
    // The microphone (voice mode), notifications, the clipboard, and where
    // they are (the weather and the Radar), for the house only. Both the asking and the quiet checking
    // (Notification.permission, navigator.permissions) answer the same way.
    const allowed = new Set(['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'geolocation']);
    const forHouse = (url) => {
      const here = houseUrl();
      try { return Boolean(here) && new URL(url).origin === here; } catch { return false; }
    };
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(forHouse(contents.getURL()) && allowed.has(permission));
    });
    session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
      return forHouse(requestingOrigin) && allowed.has(permission);
    });
    ensureShortcuts();
    makeTray();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
