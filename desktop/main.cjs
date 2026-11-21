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

const { app, BrowserWindow, ipcMain, shell, session, Menu, Tray, nativeImage, net, clipboard, Notification } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const backupKey = require('./backup-key.cjs');

/** Windows ties notifications to this id; the installer's Start menu entry carries the same one. */
const APP_ID = 'com.aerie.desktop';
// The toast activator Windows calls when a notification is clicked, kept the
// same every run and written into the Start menu shortcut, so a click on one of
// ours, even after it has gone into the corner's list, brings the window
// forward, the way other chat apps' notifications do.
const TOAST_CLSID = '{6F2B7C1E-4A3D-4E8B-9C21-AE51D0F7B3C4}';

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
// Plain http is only for an address that never leaves this machine or the
// private network (a tailnet, a home LAN), where nobody between can read or
// change what comes back; anything on the open internet has to be https,
// because this app runs whatever the address serves and installs updates from
// it (fourth outside audit, Nov 20 2026).
function privateHost(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.ts.net')) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]); const b = Number(m[2]);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}

function cleanUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim().includes('://') ? value.trim() : `https://${value.trim()}`);
    if (url.protocol === 'https:') return url.origin;
    if (url.protocol === 'http:' && privateHost(url.hostname)) return url.origin;
    return null;
  } catch {
    return null;
  }
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * A question asked by the app itself, not the page: a page cannot answer it.
 * It is the app's own little window in the house's dark and ember, not
 * Windows' grey message box. Its buttons are links the app catches before they go anywhere,
 * and nothing from the house is loaded into it.
 */
function askHer(message, detail, yes, { no = 'Cancel', big = null } = {}) {
  return new Promise((resolve) => {
    // Only the house's own window is a parent. A question asked right after
    // another one found the first, still closing, as its parent and went down
    // with it, so the backup's phrase never showed.
    const parent = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null;
    // Tall enough for its words, so it never scrolls.
    const lines = String(detail).split('\n').reduce((n, para) => n + Math.max(1, Math.ceil(para.length / 58)), 0);
    const height = Math.min(640, 150 + lines * 20 + (big ? 100 : 0));
    const ask = new BrowserWindow({
      width: 480, height, useContentSize: true, resizable: false, minimizable: false, maximizable: false,
      frame: false, show: false, modal: !!parent, parent: parent || undefined, backgroundColor: '#1a1416', title: 'Aerie',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
    });
    let done = false;
    const finish = (answer) => { if (done) return; done = true; resolve(answer); if (!ask.isDestroyed()) ask.close(); };
    const caught = (event, url) => { event.preventDefault(); finish(url === 'https://answer.aerie.invalid/yes'); };
    ask.webContents.on('will-navigate', caught);
    ask.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    ask.on('closed', () => finish(false));
    const body = escapeHtml(detail).replace(/\n/g, '<br>');
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  html,body{margin:0;height:100%;background:#1a1416;color:#f2e6e1;font:14px/1.5 Georgia,'Times New Roman',serif;-webkit-user-select:none;user-select:none}
  body{display:flex;flex-direction:column;box-sizing:border-box;padding:22px 24px 20px;border:1px solid #3a2a2f;border-radius:0}
  .bar{-webkit-app-region:drag;height:10px;margin:-22px -24px 12px}
  h1{margin:0 0 10px;font-size:17px;font-weight:600;letter-spacing:.01em}
  .big{margin:4px 0 14px;padding:14px 10px;border-radius:14px;background:#24191c;border:1px solid #4a2f36;text-align:center;font:600 20px/1.4 Consolas,'Courier New',monospace;letter-spacing:.08em;-webkit-user-select:text;user-select:text}
  p{margin:0;color:#cdb9b2;font-size:13px;flex:1;overflow:auto}
  ::-webkit-scrollbar{display:none}
  .row{display:flex;gap:10px;justify-content:flex-end;margin-top:18px}
  a{display:inline-block;padding:9px 18px;border-radius:999px;text-decoration:none;font-weight:600;font-size:13px;-webkit-app-region:no-drag}
  .no{color:#e8d8d2;border:1px solid #4a3a3f}
  .yes{color:#fff4ef;background:linear-gradient(90deg,#8a2f39,#5f3a50);border:1px solid #9a4450}
  a:hover{filter:brightness(1.12)}
</style></head><body><div class="bar"></div><h1>${escapeHtml(message)}</h1>${big ? `<div class="big">${escapeHtml(big)}</div>` : ''}<p>${body}</p>
<div class="row"><a class="no" href="https://answer.aerie.invalid/no">${escapeHtml(no)}</a><a class="yes" href="https://answer.aerie.invalid/yes">${escapeHtml(yes)}</a></div></body></html>`;
    void ask.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    ask.once('ready-to-show', () => ask.show());
  });
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

// The page the app is showing can ask to point the app somewhere else. Only
// the app's own setup page (a file on this laptop) may do that without asking;
// any other page gets a question from the app itself first, so a page the
// house shows cannot quietly move their laptop to another address (fourth
// outside audit, Nov 20 2026).
ipcMain.handle('aerie:set-house', async (event, value) => {
  const url = cleanUrl(value);
  if (!url) return { ok: false };
  const from = (event.senderFrame && event.senderFrame.url) || '';
  if (!from.startsWith('file:')) {
    const yes = await askHer('Open a different house?', `Something on the page asked to point this app at ${url}. Only say yes if you just asked for that.`, 'Open it');
    if (!yes) return { ok: false, error: 'Not changed.' };
  }
  writeJson(configFile(), { url });
  const win = BrowserWindow.getAllWindows()[0];
  if (win) void win.loadURL(url);
  return { ok: true };
});

// ---- the window, the tray, and the app itself ----

// ---- the sealed backup ----
// The house seals a copy of its database every night to a key only this
// laptop's phrase can open (services/sealed-backup.ts in the backend), and
// this app brings the newest copy home whenever it is open, keeping three in
// Documents\Aerie Backups. Setting it up makes a phrase here, shows it once to
// be written on paper, and hands the house only the public half. The phrase is
// never saved anywhere; losing it means the copies cannot be opened.

const BACKUPS_KEPT = 3;
const BACKUP_EVERY_MS = 6 * 60 * 60 * 1000;
let backupBusy = false;

function backupDir() {
  return path.join(app.getPath('documents'), 'Aerie Backups');
}

/** The house's login cookie, sent by hand: the app's own fetches carry no cookies on their own. */
async function houseHeaders(house) {
  const cookies = await session.defaultSession.cookies.get({ url: house });
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return cookie ? { Cookie: cookie } : {};
}

async function houseJson(house, method, route, body) {
  const headers = { ...(await houseHeaders(house)), ...(body ? { 'Content-Type': 'application/json' } : {}) };
  const res = await net.fetch(`${house}/api${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, data };
}

function backupsOnDisk() {
  try {
    return fs.readdirSync(backupDir())
      .filter((n) => /^aerie-backup-.*\.sealed$/.test(n))
      .map((name) => ({ name, at: fs.statSync(path.join(backupDir(), name)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

function backupNote(text) {
  const config = readJson(configFile()) || {};
  writeJson(configFile(), { ...config, backupNote: `${new Date().toLocaleString()}: ${text}` });
  if (tray) tray.setToolTip(`Aerie\nBackup: ${text}`);
  makeTrayMenu();
}

/** Bring the house's newest sealed copy home if it is not here yet. */
async function fetchBackup({ quiet } = { quiet: true }) {
  const house = houseUrl();
  const config = readJson(configFile()) || {};
  if (!house || !config.backupSetUp || backupBusy) return;
  backupBusy = true;
  try {
    const status = await houseJson(house, 'GET', '/backup/status');
    if (status.status === 401) { if (!quiet) backupNote('sign in to the house in the window first'); return; }
    const latest = status.ok && status.data ? status.data.latest : null;
    if (!latest) { backupNote(status.data && status.data.lastError ? `the house could not make one (${status.data.lastError})` : 'none made yet'); return; }
    if (!/^aerie-backup-[\w-]+\.sealed$/.test(latest.name)) return;
    fs.mkdirSync(backupDir(), { recursive: true });
    const final = path.join(backupDir(), latest.name);
    if (fs.existsSync(final) && fs.statSync(final).size === latest.bytes) { if (!quiet) backupNote(`up to date (${latest.name})`); return; }
    const res = await net.fetch(`${house}/api/backup/latest`, { headers: await houseHeaders(house) });
    if (!res.ok || !res.body) { backupNote(`the house answered ${res.status}`); return; }
    const part = `${final}.part`;
    const out = fs.createWriteStream(part);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    if (fs.statSync(part).size !== latest.bytes) { fs.rmSync(part, { force: true }); backupNote('the download came up short; trying again later'); return; }
    fs.renameSync(part, final);
    for (const old of backupsOnDisk().slice(BACKUPS_KEPT)) fs.rmSync(path.join(backupDir(), old.name), { force: true });
    backupNote(`saved ${latest.name}`);
  } catch (error) {
    backupNote(`could not reach the house (${error instanceof Error ? error.message : String(error)})`);
  } finally {
    backupBusy = false;
  }
}

/** Make a phrase, show it once, hand the house the public half, and take the first copy. */
async function setUpBackups() {
  const house = houseUrl();
  if (!house) return;
  const config = readJson(configFile()) || {};
  const first = await askHer(
    config.backupSetUp ? 'Make a new backup phrase?' : 'Set up backups on this laptop?',
    `The house will seal a copy of its database every night that only a phrase made here can open, and this app keeps the newest ${BACKUPS_KEPT} in Documents\\Aerie Backups.\n\nYou will be shown the phrase once. Write it on paper. It is never saved on this laptop or sent to the house, and without it no backup can be opened.`
      + (config.backupSetUp ? '\n\nA new phrase means new backups open with the new one; the copies already here still need the old one.' : ''),
    'Show me the phrase',
  );
  if (!first) return;
  const phrase = backupKey.newPhrase();
  const wrote = await askHer('Your backup phrase', 'Write this on paper now, exactly as shown, and keep it somewhere safe. 0 and O, 1 and I or L count as the same when you type it back.', 'I wrote it down', { big: phrase });
  if (!wrote) return;
  const publicKey = backupKey.publicKeyFromPhrase(phrase).toString('base64');
  const set = await houseJson(house, 'POST', '/backup/key', { publicKey });
  if (!set.ok) { backupNote(set.status === 401 ? 'sign in to the house in the window, then set up again' : `the house answered ${set.status}`); return; }
  writeJson(configFile(), { ...(readJson(configFile()) || {}), backupSetUp: true });
  backupNote('set up; making the first copy');
  const made = await houseJson(house, 'POST', '/backup/now');
  if (!made.ok) { backupNote(`the house could not make one (${made.data && made.data.error ? made.data.error : made.status})`); return; }
  await fetchBackup({ quiet: false });
}

async function backUpNow() {
  const house = houseUrl();
  if (!house) return;
  backupNote('the house is making a copy');
  const made = await houseJson(house, 'POST', '/backup/now');
  if (!made.ok) { backupNote(made.status === 401 ? 'sign in to the house in the window first' : `the house could not make one (${made.data && made.data.error ? made.data.error : made.status})`); return; }
  await fetchBackup({ quiet: false });
}

function startBackupFetches() {
  setTimeout(() => void fetchBackup(), 2 * 60 * 1000);
  setInterval(() => void fetchBackup(), BACKUP_EVERY_MS);
}

let mainWindow = null;
let tray = null;
/** True once they chose Quit; until then closing the window only tucks it by the clock. */
let quitting = false;

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  // Windows keeps a background app from taking the front, so a notification
  // click only flashed the taskbar. Holding the window on
  // top for a moment while it asks for focus is what lets it come forward.
  if (process.platform === 'win32') {
    mainWindow.setAlwaysOnTop(true);
    mainWindow.moveTop();
    mainWindow.focus();
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false); }, 300);
  } else {
    mainWindow.focus();
  }
}

/** One line in the house's log from the app itself, so what happened on the laptop can be read without them opening anything. */
function tellHouse(where, message) {
  const house = houseUrl();
  if (!house) return;
  void net.fetch(`${house}/api/client-errors`, {
    method: 'POST',
    session: session.defaultSession,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ where: `laptop-${where}`, message: String(message).slice(0, 500), stack: '', componentStack: '' }),
  }).catch(() => {});
}

function makeTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 32, height: 32 }));
  tray.setToolTip('Aerie');
  const note = (readJson(configFile()) || {}).backupNote;
  if (note) tray.setToolTip(`Aerie\nBackup: ${note.replace(/^[^:]*?: /, '')}`);
  makeTrayMenu();
  tray.on('click', showWindow);
}

function makeTrayMenu() {
  if (!tray) return;
  const config = readJson(configFile()) || {};
  const backups = config.backupSetUp
    ? [
      { label: 'Back up now', click: () => void backUpNow() },
      { label: 'Open the backups folder', click: () => { fs.mkdirSync(backupDir(), { recursive: true }); void shell.openPath(backupDir()); } },
      { label: config.backupNote ? `Last: ${config.backupNote}`.slice(0, 90) : 'Nothing brought home yet', enabled: false },
      { type: 'separator' },
      { label: 'Make a new phrase…', click: () => void setUpBackups() },
    ]
    : [{ label: 'Set up backups…', click: () => void setUpBackups() }];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Aerie', click: showWindow },
    { label: 'Backups', submenu: backups },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

ipcMain.handle('aerie:show', () => { tellHouse('notify-click', 'the page asked to come forward'); showWindow(); return true; });

// The app's own notifications, made here rather than by the page. A page's
// notification in this app showed and never reported a click, by its own
// handler or Windows' activation. One made here carries its click to this
// process directly. Each is kept until it closes, or a collected one loses
// its click.
const liveNotes = new Set();
ipcMain.handle('aerie:notify', (_event, title, body) => {
  if (!Notification.isSupported()) return false;
  const icon = path.join(__dirname, 'icon.png');
  // On Windows the toast opens aerie://open when clicked. A click on the
  // app's own toast reached it neither as a click nor through Windows'
  // activation (shown, then closed, no click), and
  // a link needs no COM route: Windows starts this exe with the link, the
  // second copy hands over to this one ('second-instance') and the window
  // comes forward. The aerie: link is registered for this exe at start.
  const esc = (t) => String(t).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
  const iconXml = fs.existsSync(icon) ? `<image placement="appLogoOverride" hint-crop="circle" src="${esc(pathToFileURL(icon).href)}"/>` : '';
  const toastXml = process.platform === 'win32'
    ? `<toast activationType="protocol" launch="aerie://open"><visual><binding template="ToastGeneric"><text>${esc(String(title).slice(0, 120))}</text><text>${esc(String(body).slice(0, 400))}</text>${iconXml}</binding></visual></toast>`
    : undefined;
  const note = new Notification({ title: String(title).slice(0, 120), body: String(body).slice(0, 400), ...(fs.existsSync(icon) ? { icon } : {}), ...(toastXml ? { toastXml } : {}) });
  liveNotes.add(note);
  const forget = () => liveNotes.delete(note);
  note.on('click', () => { tellHouse('notify-click', 'clicked (the app\'s own notification)'); forget(); showWindow(); });
  // Every way a notification can end goes in the house's log, so a click
  // that never arrives shows what happened instead.
  note.on('close', (event) => { tellHouse('notify-click', `closed (${event && event.reason ? event.reason : 'no reason given'})`); forget(); });
  note.on('action', () => { tellHouse('notify-click', 'an action button'); showWindow(); });
  note.on('failed', (_e, error) => { tellHouse('notify-click', `Windows refused it: ${error}`); forget(); });
  note.show();
  tellHouse('notify-click', `shown by the app; window ${mainWindow && mainWindow.isVisible() ? (mainWindow.isMinimized() ? 'minimized' : 'open') : 'tucked in the tray'}`);
  return true;
});

// Windows only reports an entry as on when it is asked with the SAME args it
// was written with: asked bare, an entry made with --hidden reads as off, so
// the switch flipped itself back every time. Every read and write uses this.
const LOGIN_ITEM = { args: ['--hidden'] };
const startsWithWindows = () => app.getLoginItemSettings(LOGIN_ITEM).openAtLogin;

ipcMain.handle('aerie:about', () => ({
  version: app.getVersion(),
  startWithWindows: process.platform === 'win32' ? startsWithWindows() : null,
  lastUpdate,
}));

ipcMain.handle('aerie:start-with-windows', (_event, on) => {
  if (process.platform !== 'win32') return null;
  app.setLoginItemSettings({ openAtLogin: Boolean(on), ...LOGIN_ITEM });
  return startsWithWindows();
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
  // Asked by the app, not the page, so a page cannot start an install on its
  // own; and never from a plain-http house on the open internet (cleanUrl).
  const yes = await askHer('Install the update?', `This replaces the Aerie app with the copy ${house} is offering, and restarts it.`, 'Install');
  if (!yes) return { ok: false, error: 'Not installed.' };
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
    toastActivatorClsid: TOAST_CLSID,
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
    // What Windows will read when a notification is clicked: the Start menu
    // shortcut's id and activator must match this app's, or a click has
    // nowhere to go. Said once per start in the house's log.
    try {
      const back = shell.readShortcutLink(startMenu);
      tellHouse('notify-setup', `shortcut ${back.target === process.execPath ? 'points here' : `points at ${back.target}`}, id ${back.appUserModelId === APP_ID ? 'matches' : `is ${back.appUserModelId}`}, activator ${String(back.toastActivatorClsid).toUpperCase() === TOAST_CLSID.toUpperCase() ? 'matches' : `is ${back.toastActivatorClsid}`}`);
    } catch (err) { tellHouse('notify-setup', `shortcut could not be read back: ${err}`); }
  } catch (err) {
    // Without the shortcut they still have the app; only its notifications wait.
    tellHouse('notify-setup', `shortcut could not be written: ${err}`);
  }
  // A start-with-Windows entry names the exe's path, so a moved folder gets it refreshed.
  try {
    if (startsWithWindows()) app.setLoginItemSettings({ openAtLogin: true, ...LOGIN_ITEM });
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
  // A right-click menu, which a browser gives every page and Electron gives
  // none: spelling fixes on a misspelled word, cut, copy and paste where
  // they apply, select all inside a box they type in, and copying a link or
  // a picture.
  win.webContents.on('context-menu', (_event, params) => {
    const items = [];
    if (params.misspelledWord) {
      for (const word of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: word, click: () => win.webContents.replaceMisspelling(word) });
      }
      if (params.dictionarySuggestions.length === 0) items.push({ label: 'No suggestions', enabled: false });
      items.push({ label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (params.linkURL && /^https?:/i.test(params.linkURL)) {
      items.push({ label: 'Open link in browser', click: () => void shell.openExternal(params.linkURL) });
      items.push({ label: 'Copy link', click: () => clipboard.writeText(params.linkURL) });
      items.push({ type: 'separator' });
    }
    if (params.mediaType === 'image' && params.srcURL) {
      items.push({ label: 'Copy picture', click: () => win.webContents.copyImageAt(params.x, params.y) });
      items.push({ type: 'separator' });
    }
    const flags = params.editFlags || {};
    if (params.isEditable) {
      items.push({ role: 'cut', enabled: Boolean(flags.canCut) });
      items.push({ role: 'copy', enabled: Boolean(flags.canCopy) });
      items.push({ role: 'paste', enabled: Boolean(flags.canPaste) });
      items.push({ role: 'selectAll' });
    } else {
      // No Select all out here: it would take the whole page, every message
      // and every button, not a bubble.
      items.push({ role: 'copy', enabled: Boolean(params.selectionText && params.selectionText.trim()) });
    }
    while (items.length && items[items.length - 1].type === 'separator') items.pop();
    Menu.buildFromTemplate(items).popup({ window: win });
  });

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
  app.on('second-instance', (_event, argv) => {
    const link = (argv || []).find((x) => typeof x === 'string' && x.startsWith('aerie:'));
    tellHouse('notify-click', link ? `a notification was clicked (${link}), so the window comes forward` : 'opened again, so the open window comes forward');
    showWindow();
  });
  // aerie: links open this app (a clicked notification uses one). An unzipped
  // app names its own exe; written for this user only, every start, so a moved
  // folder is followed.
  if (process.platform === 'win32') {
    try { app.setAsDefaultProtocolClient('aerie', process.execPath, []); } catch { /* the click then only reaches the corner list */ }
  }
  app.on('before-quit', () => { quitting = true; });
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_ID);
    try { app.setToastActivatorCLSID(TOAST_CLSID); } catch { /* the old random one, clicks then only work while a toast is up */ }
  }

  app.userAgentFallback = `${app.userAgentFallback} ${AGENT_MARK}`;

  app.whenReady().then(() => {
    readLastUpdate();
    // Any click on one of our notifications, live or from the corner's list,
    // or one that started the app, brings the window forward.
    if (process.platform === 'win32' && typeof Notification.handleActivation === 'function') {
      try {
        Notification.handleActivation((details) => {
          tellHouse('notify-click', `activated (${details && details.type ? details.type : 'click'}), window ${mainWindow && mainWindow.isVisible() ? 'open' : 'tucked'}`);
          showWindow();
        });
      } catch (err) { tellHouse('notify-click', `handleActivation unavailable: ${err}`); }
    }
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
    startBackupFetches();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
