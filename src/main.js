'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const sharp = require('sharp');
const { autoUpdater } = require('electron-updater');
const P = require('./processor');

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

// ---------- Previews: wm://img/?p=<ruta>&s=<tamaño> ----------
// s=0 en fotos = archivo original sin recomprimir (para comparar al 100%)
const previewCache = new Map();
const CACHE_MAX = 400;
const BROWSER_NATIVE = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const durations = new Map();

async function makePreview(p, size) {
  const key = p + '|' + size;
  if (previewCache.has(key)) return previewCache.get(key);
  let out;
  if (P.kindOf(p) === 'video') {
    if (!durations.has(p)) durations.set(p, (await P.probeVideo(p)).duration);
    out = { buf: await P.videoFrame(p, size, durations.get(p)), type: 'image/jpeg' };
  } else if (size === 0 && BROWSER_NATIVE.has(path.extname(p).toLowerCase())) {
    out = { buf: await fsp.readFile(p), type: 'image/' + (path.extname(p).toLowerCase() === '.png' ? 'png' : path.extname(p).toLowerCase() === '.webp' ? 'webp' : 'jpeg') };
    return out; // no se cachea (puede ser grande)
  } else {
    let img = sharp(p, { failOn: 'none', limitInputPixels: false }).rotate();
    if (size > 0) img = img.resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true });
    out = size === 0 ? { buf: await img.png().toBuffer(), type: 'image/png' }
      : { buf: await img.webp({ quality: size > 1000 ? 88 : 78 }).toBuffer(), type: 'image/webp' };
  }
  previewCache.set(key, out);
  if (previewCache.size > CACHE_MAX) previewCache.delete(previewCache.keys().next().value);
  return out;
}

function registerProtocol() {
  protocol.handle('wm', async (req) => {
    try {
      const u = new URL(req.url);
      const r = await makePreview(u.searchParams.get('p'), parseInt(u.searchParams.get('s') || '0', 10));
      return new Response(r.buf, { headers: { 'content-type': r.type } });
    } catch (e) {
      return new Response('error', { status: 500 });
    }
  });
}

// ---------- Rutas de salida (respeta subcarpetas) ----------
function outBaseFor(item, outDir, used) {
  const dir = path.join(outDir, ...(item.relDir ? item.relDir.split('/') : []));
  let base = path.join(dir, path.parse(item.name).name);
  if (path.resolve(base).toLowerCase() === path.resolve(item.path.slice(0, -path.extname(item.path).length)).toLowerCase()) base += '_export';
  let candidate = base, n = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${base}_${n++}`;
  used.add(candidate.toLowerCase());
  return { dir, base: candidate };
}

// ---------- IPC ----------
let currentAbort = null;

function registerIpc() {
  ipcMain.handle('app-version', () => app.getVersion());
  ipcMain.handle('config-load', () => readConfig());
  ipcMain.handle('config-save', (_e, cfg) => writeConfig(cfg));
  ipcMain.handle('has-ffmpeg', () => !!P.FFMPEG && fs.existsSync(P.FFMPEG));

  ipcMain.handle('pick-folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Elegir carpeta (se incluyen las subcarpetas)', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return r.filePaths[0];
  });

  ipcMain.handle('scan-folder', async (_e, dir, skip) => {
    try {
      const st = await fsp.stat(dir);
      if (!st.isDirectory()) dir = path.dirname(dir);
      return await P.scanFolder(dir, skip);
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
  ipcMain.handle('load-watermark', async (_e, p) => { try { return await loadWatermark(p); } catch { return null; } });

  ipcMain.handle('pick-output', async (_e, defaultPath) => {
    const r = await dialog.showOpenDialog(win, { title: 'Carpeta de salida', defaultPath, properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return r.filePaths[0];
  });

  ipcMain.handle('open-path', (_e, p) => shell.openPath(p));

  // Vista previa de cómo queda una foto exportada (para comparar calidad / peso)
  ipcMain.handle('preview-image', async (_e, item, job) => {
    const r = await P.renderImage(item, job);
    const type = job.photo.format === 'png' ? 'image/png' : 'image/jpeg';
    return { url: `data:${type};base64,${r.buf.toString('base64')}`, bytes: r.buf.length, quality: r.quality, width: r.width, height: r.height };
  });

  ipcMain.handle('estimate-video', async (_e, item, job) => {
    try { return await P.estimateVideo(item, job); } catch (err) { return { error: String(err.message || err) }; }
  });

  ipcMain.handle('export-cancel', () => { if (currentAbort) currentAbort.abort(); });

  ipcMain.handle('export', async (e, job) => {
    const abort = new AbortController();
    currentAbort = abort;
    const used = new Set();
    const plan = job.items.map((it) => ({ it, ...outBaseFor(it, job.outDir, used) }));
    const total = plan.length;
    let done = 0, inBytes = 0, outBytes = 0;
    const errors = [];
    const send = (d) => { if (!e.sender.isDestroyed()) e.sender.send('export-progress', { total, done, ...d }); };

    const runOne = async ({ it, dir, base }) => {
      if (abort.signal.aborted) return;
      send({ name: it.rel, frac: 0 });
      try {
        await fsp.mkdir(dir, { recursive: true });
        const r = it.kind === 'video'
          ? await P.exportVideo(it, job, base, { signal: abort.signal, onProgress: (f) => send({ name: it.rel, frac: f }) })
          : await P.exportImage(it, job, base);
        inBytes += it.bytes || 0; outBytes += r.bytes;
      } catch (err) {
        if (!abort.signal.aborted) errors.push({ name: it.rel, message: String(err.message || err) });
      }
      done++;
      send({ name: it.rel, frac: 1 });
    };

    // Fotos de 2 en 2; videos de uno en uno (ffmpeg ya usa todos los núcleos)
    await P.mapLimit(plan.filter((x) => x.it.kind !== 'video'), 2, runOne);
    for (const x of plan.filter((x) => x.it.kind === 'video')) await runOne(x);
    currentAbort = null;
    return { done, errors, outDir: job.outDir, canceled: abort.signal.aborted, inBytes, outBytes };
  });

  // Actualizaciones
  ipcMain.handle('update-check', async () => {
    if (!app.isPackaged) return { state: 'dev' };
    try { await autoUpdater.checkForUpdates(); return { state: 'checking' }; } catch (err) { return { state: 'error', message: String(err.message || err) }; }
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
  autoUpdater.on('update-available', (info) => sendUpdate({ state: 'available', version: info.version }));
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
    width: 1440, height: 920, minWidth: 1050, minHeight: 660,
    backgroundColor: '#1b1c1f', title: 'Marca de Agua', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
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
  app.on('window-all-closed', () => { if (currentAbort) currentAbort.abort(); app.quit(); });
}
