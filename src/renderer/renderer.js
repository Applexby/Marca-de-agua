'use strict';
/* global api */

// ---------------- Estado ----------------
const DEFAULT_GLOBAL = { scale: 30, opacity: 50, margin: 3, anchor: 'c', cx: 0.5, cy: 0.5 };
const S = {
  dir: null,
  images: [],
  wm: null,                 // { path, name, width, height }
  global: { ...DEFAULT_GLOBAL },
  overrides: {},            // nombre -> ajustes propios
  excluded: new Set(),
  outDirCustom: null,
  exp: { format: 'jpg', quality: 92, limitOn: false, limitKB: 300, resizeOn: false, maxEdge: 2048 },
  thumb: 220,
  current: -1,
  folders: {}               // memoria de ajustes por carpeta
};
const ANCHORS = { tl: [0, 0], t: [1, 0], tr: [2, 0], l: [0, 1], c: [1, 1], r: [2, 1], bl: [0, 2], b: [1, 2], br: [2, 2] };
const $ = (id) => document.getElementById(id);
const imgURL = (p, s) => `wm://img/?p=${encodeURIComponent(p)}&s=${s}`;
const sep = navigator.userAgent.includes('Windows') ? '\\' : '/';

// ---------------- Cálculo de la caja del logo ----------------
// Devuelve fracciones relativas a la imagen: { l, t, w, h }
function layout(img, s) {
  if (!S.wm) return null;
  const W = img.width, H = img.height;
  const ar = S.wm.height / S.wm.width;
  const minSide = Math.min(W, H);
  let lw = (s.scale / 100) * minSide;
  let lh = lw * ar;
  const k = Math.min(1, W / lw, H / lh);
  lw *= k; lh *= k;
  let cx, cy;
  if (s.anchor && ANCHORS[s.anchor]) {
    const m = (s.margin / 100) * minSide;
    const [col, row] = ANCHORS[s.anchor];
    cx = col === 0 ? m + lw / 2 : col === 2 ? W - m - lw / 2 : W / 2;
    cy = row === 0 ? m + lh / 2 : row === 2 ? H - m - lh / 2 : H / 2;
  } else {
    cx = s.cx * W; cy = s.cy * H;
  }
  cx = Math.max(lw / 2, Math.min(W - lw / 2, cx));
  cy = Math.max(lh / 2, Math.min(H - lh / 2, cy));
  return { l: (cx - lw / 2) / W, t: (cy - lh / 2) / H, w: lw / W, h: lh / H };
}
const settingsFor = (img) => S.overrides[img.name] || S.global;

function placeLogo(el, img) {
  const s = settingsFor(img);
  const b = layout(img, s);
  if (!b) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.style.left = b.l * 100 + '%';
  el.style.top = b.t * 100 + '%';
  el.style.width = b.w * 100 + '%';
  el.style.height = b.h * 100 + '%';
  el.style.opacity = s.opacity / 100;
}

// ---------------- Persistencia ----------------
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (S.dir) S.folders[S.dir] = { overrides: S.overrides, excluded: [...S.excluded], outDirCustom: S.outDirCustom };
    api.saveConfig({
      watermarkPath: S.wm ? S.wm.path : null,
      global: S.global, exp: S.exp, thumb: S.thumb, lastDir: S.dir, folders: S.folders
    });
  }, 300);
}

// ---------------- Grilla ----------------
function frameClass(img) { return img.width >= img.height ? 'frame land' : 'frame port'; }

function renderGrid() {
  const grid = $('grid');
  grid.innerHTML = '';
  $('empty').classList.toggle('hidden', S.images.length > 0);
  $('toolbar').classList.toggle('hidden', S.images.length === 0);
  const frag = document.createDocumentFragment();
  S.images.forEach((img, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.i = i;
    card.innerHTML = `
      <div class="box"><div class="${frameClass(img)}" style="aspect-ratio:${img.width}/${img.height}">
        <img class="photo" loading="lazy" src="${imgURL(img.path, 480)}" alt="">
        <img class="logo" alt="">
      </div></div>
      <div class="meta">
        <input type="checkbox" class="inc" title="Incluir en exportación">
        <span class="ellipsis grow" title="${img.name}">${img.name}</span>
        <span class="badge hidden">Ajustada</span>
      </div>`;
    card.querySelector('.inc').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleInclude(img.name, e.target.checked);
    });
    card.addEventListener('click', () => openEditor(i));
    frag.appendChild(card);
  });
  grid.appendChild(frag);
  refreshCards();
}

function refreshCards() {
  const wmSrc = S.wm ? imgURL(S.wm.path, 1200) : '';
  document.querySelectorAll('.card').forEach((card) => {
    const img = S.images[+card.dataset.i];
    const logo = card.querySelector('.logo');
    if (S.wm && logo.dataset.src !== wmSrc) { logo.src = wmSrc; logo.dataset.src = wmSrc; }
    placeLogo(logo, img);
    const inc = !S.excluded.has(img.name);
    card.querySelector('.inc').checked = inc;
    card.classList.toggle('excluded', !inc);
    card.querySelector('.badge').classList.toggle('hidden', !S.overrides[img.name]);
  });
  updateCounts();
}

function updateCounts() {
  const n = S.images.length;
  const inc = S.images.filter((i) => !S.excluded.has(i.name)).length;
  const adj = Object.keys(S.overrides).filter((k) => S.images.some((i) => i.name === k)).length;
  $('countLabel').textContent = `${n} imágenes · ${inc} para exportar` + (adj ? ` · ${adj} con ajuste propio` : '');
  const btn = $('btnExport');
  btn.textContent = inc ? `Exportar ${inc} imagen${inc === 1 ? '' : 'es'}` : 'Exportar';
  btn.disabled = !inc || !S.wm;
  btn.title = !S.wm ? 'Primero elige el logo' : '';
  $('outLabel').textContent = outDir() || '—';
  $('outLabel').title = outDir() || '';
}

function toggleInclude(name, on) {
  if (on) S.excluded.delete(name); else S.excluded.add(name);
  refreshCards();
  persist();
}

// ---------------- Carga de carpeta / logo ----------------
function outDir() {
  if (S.outDirCustom) return S.outDirCustom;
  return S.dir ? S.dir + sep + 'con_marca' : null;
}

function setFolder(res) {
  if (!res) return;
  if (S.dir) S.folders[S.dir] = { overrides: S.overrides, excluded: [...S.excluded], outDirCustom: S.outDirCustom };
  S.dir = res.dir;
  S.images = res.images;
  const mem = S.folders[res.dir] || {};
  S.overrides = mem.overrides || {};
  S.excluded = new Set(mem.excluded || []);
  S.outDirCustom = mem.outDirCustom || null;
  $('folderLabel').textContent = res.dir;
  $('folderLabel').title = res.dir;
  renderGrid();
  if (!res.images.length) toast('No se encontraron imágenes (JPG, PNG, WEBP, TIFF) en esa carpeta.');
  persist();
}

function setWatermark(wm) {
  if (!wm) return;
  S.wm = wm;
  const box = $('logoPreview');
  box.classList.remove('empty');
  box.innerHTML = `<img src="${imgURL(wm.path, 600)}" alt="">`;
  box.title = wm.name + ' — clic para cambiar';
  refreshCards();
  if (S.current >= 0) renderEditor();
  persist();
}

async function pickFolder() { setFolder(await api.pickFolder()); }
async function pickLogo() { setWatermark(await api.pickWatermark()); }

// ---------------- Controles de posición (3x3) ----------------
function buildAnchorGrid(el, onPick) {
  el.innerHTML = '';
  Object.keys(ANCHORS).forEach((k) => {
    const b = document.createElement('button');
    b.dataset.a = k;
    b.title = { tl: 'Arriba izq.', t: 'Arriba', tr: 'Arriba der.', l: 'Izquierda', c: 'Centro', r: 'Derecha', bl: 'Abajo izq.', b: 'Abajo', br: 'Abajo der.' }[k];
    b.addEventListener('click', () => onPick(k));
    el.appendChild(b);
  });
}
function markAnchor(el, a) { el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.a === a)); }

// ---------------- Ajuste general ----------------
function syncGlobalUI() {
  const g = S.global;
  $('gScale').value = g.scale; $('gScaleVal').textContent = g.scale + '%';
  $('gOpacity').value = g.opacity; $('gOpacityVal').textContent = g.opacity + '%';
  $('gMargin').value = g.margin; $('gMarginVal').textContent = g.margin + '%';
  markAnchor($('gAnchor'), g.anchor);
}
function onGlobalChange() {
  syncGlobalUI();
  refreshCards();
  if (S.current >= 0) renderEditor();
  persist();
}

// ---------------- Editor individual ----------------
function currentImg() { return S.images[S.current]; }

function openEditor(i) {
  S.current = i;
  $('editor').classList.remove('hidden');
  renderEditor(true);
}
function closeEditor() {
  S.current = -1;
  $('editor').classList.add('hidden');
  refreshCards();
}

function fitEditorFrame() {
  const img = currentImg(); if (!img) return;
  const stage = $('stage');
  const aw = stage.clientWidth - 140, ah = stage.clientHeight - 56;
  const k = Math.min(aw / img.width, ah / img.height);
  const f = $('edFrame');
  f.style.width = Math.round(img.width * k) + 'px';
  f.style.height = Math.round(img.height * k) + 'px';
}

function renderEditor(newImage) {
  const img = currentImg(); if (!img) return;
  if (newImage) {
    $('edPhoto').src = imgURL(img.path, 480);   // la miniatura ya está en caché: aparece al instante
    const hi = new Image();
    const target = img.path;
    hi.onload = () => { if (currentImg() && currentImg().path === target) $('edPhoto').src = hi.src; };
    hi.src = imgURL(img.path, 2000);
  }
  fitEditorFrame();
  const logo = $('edLogo');
  if (S.wm) logo.src = imgURL(S.wm.path, 1200);
  placeLogo(logo, img);
  const s = settingsFor(img);
  const custom = !!S.overrides[img.name];
  $('edName').textContent = img.name;
  $('edInfo').textContent = `${img.width} × ${img.height} px · ${(img.bytes / 1024 / 1024).toFixed(1)} MB · ${S.current + 1} de ${S.images.length}`;
  $('edMode').textContent = custom ? 'Ajuste propio (solo esta imagen)' : 'Usando ajuste general';
  $('edMode').className = 'pill' + (custom ? ' custom' : '');
  $('eScale').value = s.scale; $('eScaleVal').textContent = Math.round(s.scale) + '%';
  $('eOpacity').value = s.opacity; $('eOpacityVal').textContent = s.opacity + '%';
  $('eMargin').value = s.margin; $('eMarginVal').textContent = s.margin + '%';
  markAnchor($('eAnchor'), s.anchor);
  $('edInclude').checked = !S.excluded.has(img.name);
  $('edReset').disabled = !custom;
}

function editOverride(patch) {
  const img = currentImg(); if (!img) return;
  const base = S.overrides[img.name] || { ...S.global };
  S.overrides[img.name] = { ...base, ...patch };
  renderEditor();
  persist();
}

function navEditor(d) {
  if (!S.images.length) return;
  S.current = (S.current + d + S.images.length) % S.images.length;
  renderEditor(true);
}

// Arrastrar el logo
(function setupDrag() {
  const logo = $('edLogo');
  let drag = null;
  logo.addEventListener('pointerdown', (e) => {
    const img = currentImg(); if (!img || !S.wm) return;
    const fr = $('edFrame').getBoundingClientRect();
    const b = layout(img, settingsFor(img));
    drag = { x: e.clientX, y: e.clientY, fr, cx: (b.l + b.w / 2), cy: (b.t + b.h / 2) };
    logo.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  logo.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const cx = drag.cx + (e.clientX - drag.x) / drag.fr.width;
    const cy = drag.cy + (e.clientY - drag.y) / drag.fr.height;
    editOverride({ anchor: null, cx, cy });
  });
  const end = () => { drag = null; };
  logo.addEventListener('pointerup', end);
  logo.addEventListener('pointercancel', end);
  // Rueda del mouse sobre el logo = escalar
  logo.addEventListener('wheel', (e) => {
    e.preventDefault();
    const s = settingsFor(currentImg());
    editOverride({ scale: Math.max(2, Math.min(100, s.scale + (e.deltaY < 0 ? 1 : -1))) });
  }, { passive: false });
})();

// ---------------- Exportación ----------------
async function doExport() {
  if (!S.wm) return toast('Primero elige el logo.');
  const items = S.images.filter((i) => !S.excluded.has(i.name)).map((img) => {
    const s = settingsFor(img);
    return { path: img.path, name: img.name, box: layout(img, s), opacity: s.opacity / 100 };
  });
  if (!items.length) return;
  const job = {
    outDir: outDir(),
    format: S.exp.format,
    quality: S.exp.quality,
    maxKB: S.exp.format === 'jpg' && S.exp.limitOn ? Math.max(20, +S.exp.limitKB || 300) : 0,
    maxEdge: S.exp.resizeOn ? Math.max(200, +S.exp.maxEdge || 2048) : 0,
    watermarkPath: S.wm.path,
    items
  };
  $('progTitle').textContent = 'Exportando…';
  $('progBar').style.width = '0%';
  $('progText').textContent = `0 de ${items.length}`;
  $('progActions').innerHTML = '';
  $('progress').classList.remove('hidden');
  const t0 = performance.now();
  const res = await api.exportImages(job);
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  $('progTitle').textContent = res.errors.length ? 'Exportación terminada con errores' : '¡Listo!';
  $('progText').innerHTML = `${res.done - res.errors.length} imágenes guardadas en ${secs}s<br><span class="ellipsis">${res.outDir}</span>` +
    (res.errors.length ? `<br><br>No se pudieron exportar:<br>${res.errors.map((e) => `• ${e.name}: ${e.message}`).join('<br>')}` : '');
  const open = document.createElement('button');
  open.className = 'btn primary'; open.textContent = 'Abrir carpeta';
  open.onclick = () => api.openPath(res.outDir);
  const close = document.createElement('button');
  close.className = 'btn'; close.textContent = 'Cerrar';
  close.onclick = () => $('progress').classList.add('hidden');
  $('progActions').append(close, open);
}
api.onExportProgress((d) => {
  $('progBar').style.width = (d.done / d.total) * 100 + '%';
  $('progText').textContent = `${d.done} de ${d.total} — ${d.name}`;
});

function syncExportUI() {
  const e = S.exp;
  document.querySelectorAll('input[name=fmt]').forEach((r) => { r.checked = r.value === e.format; });
  $('quality').value = e.quality; $('qualityVal').textContent = e.quality;
  $('limitOn').checked = e.limitOn; $('limitKB').value = e.limitKB;
  $('resizeOn').checked = e.resizeOn; $('maxEdge').value = e.maxEdge;
  const jpg = e.format === 'jpg';
  $('qualityField').classList.toggle('hidden', !jpg);
  $('limitField').classList.toggle('hidden', !jpg);
  $('limitKB').disabled = !e.limitOn;
  $('maxEdge').disabled = !e.resizeOn;
}

// ---------------- Actualizaciones ----------------
function showUpdate(d) {
  const box = $('updateBox');
  box.className = 'update';
  if (d.state === 'available') {
    box.innerHTML = `Nueva versión ${d.version} disponible <button class="btn primary">Actualizar</button>`;
    box.querySelector('button').onclick = () => { api.downloadUpdate(); showUpdate({ state: 'downloading', percent: 0 }); };
  } else if (d.state === 'downloading') {
    box.innerHTML = `Descargando actualización… ${d.percent || 0}%`;
  } else if (d.state === 'ready') {
    box.classList.add('ready');
    box.innerHTML = `Actualización lista <button class="btn primary">Reiniciar e instalar</button>`;
    box.querySelector('button').onclick = () => api.installUpdate();
  } else {
    box.classList.add('hidden');
    if (manualCheck) {
      if (d.state === 'latest') toast('Ya tienes la última versión.');
      if (d.state === 'error') toast('No se pudo buscar actualizaciones (¿sin internet?).');
      if (d.state === 'dev') toast('Modo desarrollo: las actualizaciones solo funcionan en la versión instalada.');
    }
  }
  if (d.state !== 'checking') manualCheck = false;
}
let manualCheck = false;
api.onUpdate(showUpdate);

// ---------------- Toast ----------------
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

// ---------------- Eventos ----------------
function bind() {
  $('btnFolder').onclick = pickFolder;
  $('btnFolder2').onclick = pickFolder;
  $('btnLogo').onclick = pickLogo;
  $('logoPreview').onclick = pickLogo;

  $('thumbSize').oninput = (e) => { S.thumb = +e.target.value; $('grid').style.setProperty('--thumb', S.thumb + 'px'); persist(); };

  $('gScale').oninput = (e) => { S.global.scale = +e.target.value; onGlobalChange(); };
  $('gOpacity').oninput = (e) => { S.global.opacity = +e.target.value; onGlobalChange(); };
  $('gMargin').oninput = (e) => { S.global.margin = +e.target.value; onGlobalChange(); };
  buildAnchorGrid($('gAnchor'), (a) => { S.global.anchor = a; onGlobalChange(); });
  $('btnResetAll').onclick = () => {
    if (!Object.keys(S.overrides).length) return toast('No hay ajustes individuales.');
    if (confirm('¿Quitar los ajustes individuales de todas las imágenes y usar el ajuste general?')) {
      S.overrides = {}; refreshCards(); persist();
    }
  };

  // Editor
  $('eScale').oninput = (e) => editOverride({ scale: +e.target.value });
  $('eOpacity').oninput = (e) => editOverride({ opacity: +e.target.value });
  $('eMargin').oninput = (e) => editOverride({ margin: +e.target.value });
  buildAnchorGrid($('eAnchor'), (a) => editOverride({ anchor: a }));
  $('edReset').onclick = () => { delete S.overrides[currentImg().name]; renderEditor(); persist(); };
  $('edApplyAll').onclick = () => {
    const s = { ...settingsFor(currentImg()) };
    if (!s.anchor) toast('Posición libre: se aplicará la misma ubicación relativa a todas.');
    S.global = s; S.overrides = {};
    syncGlobalUI(); renderEditor(); persist();
  };
  $('edInclude').onchange = (e) => toggleInclude(currentImg().name, e.target.checked);
  $('edClose').onclick = closeEditor;
  $('prevImg').onclick = () => navEditor(-1);
  $('nextImg').onclick = () => navEditor(1);
  $('stage').addEventListener('click', (e) => { if (e.target.id === 'stage') closeEditor(); });
  window.addEventListener('resize', () => { if (S.current >= 0) fitEditorFrame(); });
  document.addEventListener('keydown', (e) => {
    if (S.current < 0 || e.target.tagName === 'INPUT' && e.target.type === 'number') return;
    if (e.key === 'Escape') closeEditor();
    if (e.key === 'ArrowLeft') navEditor(-1);
    if (e.key === 'ArrowRight') navEditor(1);
  });

  // Exportar
  document.querySelectorAll('input[name=fmt]').forEach((r) => r.onchange = () => { S.exp.format = r.value; syncExportUI(); persist(); });
  $('quality').oninput = (e) => { S.exp.quality = +e.target.value; syncExportUI(); persist(); };
  $('limitOn').onchange = (e) => { S.exp.limitOn = e.target.checked; syncExportUI(); persist(); };
  $('limitKB').onchange = (e) => { S.exp.limitKB = +e.target.value; persist(); };
  $('resizeOn').onchange = (e) => { S.exp.resizeOn = e.target.checked; syncExportUI(); persist(); };
  $('maxEdge').onchange = (e) => { S.exp.maxEdge = +e.target.value; persist(); };
  $('btnOut').onclick = async () => {
    const p = await api.pickOutput(outDir() || undefined);
    if (p) { S.outDirCustom = p; updateCounts(); persist(); }
  };
  $('btnExport').onclick = doExport;

  $('selAll').onclick = () => { S.excluded.clear(); refreshCards(); persist(); };
  $('selNone').onclick = () => { S.images.forEach((i) => S.excluded.add(i.name)); refreshCards(); persist(); };

  $('btnVersion').onclick = async () => {
    manualCheck = true;
    const r = await api.checkUpdate();
    if (r.state === 'dev' || r.state === 'error') showUpdate(r);
  };

  // Arrastrar carpeta a la ventana
  const main = $('main');
  ['dragenter', 'dragover'].forEach((ev) => main.addEventListener(ev, (e) => { e.preventDefault(); main.classList.add('drop'); }));
  ['dragleave', 'drop'].forEach((ev) => main.addEventListener(ev, () => main.classList.remove('drop')));
  main.addEventListener('drop', async (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    setFolder(await api.scanFolder(api.pathForFile(f)));
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
}

// ---------------- Inicio ----------------
(async function init() {
  bind();
  $('version').textContent = await api.version();
  const cfg = await api.loadConfig();
  if (cfg.global) S.global = { ...DEFAULT_GLOBAL, ...cfg.global };
  if (cfg.exp) S.exp = { ...S.exp, ...cfg.exp };
  if (cfg.folders) S.folders = cfg.folders;
  if (cfg.thumb) { S.thumb = cfg.thumb; $('thumbSize').value = S.thumb; $('grid').style.setProperty('--thumb', S.thumb + 'px'); }
  syncGlobalUI();
  syncExportUI();
  if (cfg.watermarkPath) setWatermark(await api.loadWatermark(cfg.watermarkPath));
  if (cfg.lastDir) setFolder(await api.scanFolder(cfg.lastDir));
  updateCounts();
})();
