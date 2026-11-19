'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const sharp = require('sharp');
const { autoUpdater } = require('electron-updater');

const { mapLimit, scanFolder, exportOne } = require('./processor');
let win = null;

protocol.registerSchemesAsPrivileged([
  { scheme: 'wm', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

// ---------- Configuración persistente ----------
const configPath = () => path.join(app.getPath('userData'), 'config.json');
function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; }
}
function writeConfig(cfg) {
  try { fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2)); } catch (e) { console.error(e); }
}

// ---------- Previews (protocolo wm://img/?p=<ruta>&s=<tamaño>) ----------
const previewCache = new Map();
const CACHE_MAX = 400;
async function makePreview(p, size) {
  const key = p + '|' + size;
  if (previewCache.has(key)) return previewCache.get(key);
  let img = sharp(p, { failOn: 'none' }).rotate();
  if (size > 0) img = img.resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true });
  const buf = await img.webp({ quality: size > 1000 ? 88 : 78 }).toBuffer();
  previewCache.set(key, buf);
  if (previewCache.size > CACHE_MAX) previewCache.delete(previewCache.keys().next().value);
  return buf;
}

function registerProtocol() {
  protocol.handle('wm', async (req) => {
    try {
      const u = new URL(req.url);
      const p = u.searchParams.get('p');
      const s = parseInt(u.searchParams.get('s') || '0', 10);
      const buf = await makePreview(p, s);
      return new Response(buf, { headers: { 'content-type': 'image/webp' } });
    } catch (e) {
      return new Response('error', { status: 500 });
    }
  });
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('app-version', () => app.getVersion());
  ipcMain.handle('config-load', () => readConfig());
  ipcMain.handle('config-save', (_e, cfg) => writeConfig(cfg));

  ipcMain.handle('pick-folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Elegir carpeta de imágenes', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return scanFolder(r.filePaths[0]);
  });

  ipcMain.handle('scan-folder', async (_e, dir) => {
    try {
      const st = await fsp.stat(dir);
      if (!st.isDirectory()) dir = path.dirname(dir);
      return await scanFolder(dir);
    } catch { return null; }
  });

  ipcMain.handle('pick-watermark', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Elegir logo / marca de agua',
      properties: ['openFile'],
      filters: [{ name: 'Imagen (PNG recomendado)', extensions: ['png', 'webp', 'svg', 'jpg', 'jpeg'] }]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return loadWatermark(r.filePaths[0]);
  });

  ipcMain.handle('load-watermark', async (_e, p) => {
    try { return await loadWatermark(p); } catch { return null; }
  });

  ipcMain.handle('pick-output', async (_e, defaultPath) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Carpeta de salida', defaultPath, properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return r.filePaths[0];
  });

  ipcMain.handle('open-path', (_e, p) => shell.openPath(p));

  ipcMain.handle('export', async (e, job) => {
    await fsp.mkdir(job.outDir, { recursive: true });
    let done = 0;
    const errors = [];
    const total = job.items.length;
    await mapLimit(job.items, 2, async (item) => {
      try { await exportOne(item, job); } catch (err) { errors.push({ name: item.name, message: String(err.message || err) }); }
      done++;
      e.sender.send('export-progress', { done, total, name: item.name });
    });
    return { done, errors, outDir: job.outDir };
  });

  // Actualizaciones
  ipcMain.handle('update-check', async () => {
    if (!app.isPackaged) return { state: 'dev' };
    try { await autoUpdater.checkForUpdates(); return { state: 'checking' }; } catch (e) { return { state: 'error', message: String(e.message || e) }; }
  });
  ipcMain.handle('update-download', () => autoUpdater.downloadUpdate());
  ipcMain.handle('update-install', () => autoUpdater.quitAndInstall(false, true));
}

async function loadWatermark(p) {
  const m = await sharp(p, { failOn: 'none' }).metadata();
  return { path: p, name: path.basename(p), width: m.width, height: m.height };
}

// ---------- Auto-actualización (GitHub Releases) ----------
function sendUpdate(payload) { if (win && !win.isDestroyed()) win.webContents.send('update-status', payload); }
function setupUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => sendUpdate({ state: 'available', version: info.version, notes: info.releaseNotes || '' }));
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'latest' }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => sendUpdate({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => sendUpdate({ state: 'error', message: String((err && err.message) || err) }));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 3000);
  setInterval(check, 2 * 60 * 60 * 1000);
}

// ---------- Ventana ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#1b1c1f',
    title: 'Marca de Agua',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    registerProtocol();
    registerIpc();
    createWindow();
    setupUpdater();
  });
  app.on('window-all-closed', () => app.quit());
}
