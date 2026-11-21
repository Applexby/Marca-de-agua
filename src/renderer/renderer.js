'use strict';
/* global api */

// ================= Estado =================
const DEFAULT_GLOBAL = { scale: 30, opacity: 50, margin: 3, anchor: 'c', cx: 0.5, cy: 0.5 };
const S = {
  dir: null,
  items: [],                // fotos y videos (con subcarpetas)
  wmOn: true,
  wm: null,                 // { path, name, width, height }
  global: { ...DEFAULT_GLOBAL },
  overrides: {},            // ruta relativa -> ajustes propios
  excluded: new Set(),      // rutas relativas
  outDirCustom: null,
  photo: { format: 'jpg', quality: 92, limitPreset: '100', limitKB: 800, resizeOn: false, maxEdge: 2048 },
  video: { quality: 'balanced', targetMB: 50, codec: 'h264', res: 'orig', speed: 'medium' },
  filter: 'all',
  thumb: 220,
  current: -1,              // índice en S.items
  view: 'edit',             // edit | orig | out
  zoom100: false,
  folders: {}
};
const ANCHORS = { tl: [0, 0], t: [1, 0], tr: [2, 0], l: [0, 1], c: [1, 1], r: [2, 1], bl: [0, 2], b: [1, 2], br: [2, 2] };
const $ = (id) => document.getElementById(id);
const imgURL = (p, s) => `wm://img/?p=${encodeURIComponent(p)}&s=${s}`;
const SEP = '\\';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtBytes = (b) => b >= 1024 * 1024 * 1024 ? (b / 1024 ** 3).toFixed(2) + ' GB' : b >= 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const fmtDur = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

// ================= Caja del logo =================
function layout(item, s) {
  if (!S.wm || !S.wmOn) return null;
  const W = item.width, H = item.height;
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
  } else { cx = s.cx * W; cy = s.cy * H; }
  cx = Math.max(lw / 2, Math.min(W - lw / 2, cx));
  cy = Math.max(lh / 2, Math.min(H - lh / 2, cy));
  return { l: (cx - lw / 2) / W, t: (cy - lh / 2) / H, w: lw / W, h: lh / H };
}
const settingsFor = (it) => S.overrides[it.rel] || S.global;

function placeLogo(el, it) {
  const s = settingsFor(it);
  const b = layout(it, s);
  if (!b) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.style.left = b.l * 100 + '%';
  el.style.top = b.t * 100 + '%';
  el.style.width = b.w * 100 + '%';
  el.style.height = b.h * 100 + '%';
  el.style.opacity = s.opacity / 100;
}

// ================= Persistencia =================
let saveTimer = null;
function rememberFolder() {
  if (S.dir) S.folders[S.dir] = { overrides: S.overrides, excluded: [...S.excluded], outDirCustom: S.outDirCustom };
}
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    rememberFolder();
    api.saveConfig({
      watermarkPath: S.wm ? S.wm.path : null, wmOn: S.wmOn,
      global: S.global, photo: S.photo, video: S.video, thumb: S.thumb, lastDir: S.dir, folders: S.folders
    });
  }, 300);
}

// ================= Ajustes de exportación =================
function photoMaxKB() {
  if (S.photo.format !== 'jpg') return 0;
  if (S.photo.limitPreset === 'custom') return Math.max(20, +S.photo.limitKB || 800);
  return +S.photo.limitPreset || 0;
}
function buildJob(items) {
  const wmActive = S.wmOn && !!S.wm;
  return {
    outDir: outDir(),
    watermarkPath: wmActive ? S.wm.path : null,
    photo: { format: S.photo.format, quality: S.photo.quality, maxKB: photoMaxKB(), maxEdge: S.photo.resizeOn ? Math.max(200, +S.photo.maxEdge || 2048) : 0 },
    video: { ...S.video, targetMB: Math.max(1, +S.video.targetMB || 50) },
    items: items.map((it) => {
      const s = settingsFor(it);
      return { path: it.path, name: it.name, rel: it.rel, relDir: it.relDir, kind: it.kind, bytes: it.bytes,
        box: wmActive ? layout(it, s) : null, opacity: s.opacity / 100 };
    })
  };
}

function outDir() {
  if (S.outDirCustom) return S.outDirCustom;
  return autoOutDir(S.wmOn);
}
function autoOutDir(wm) {
  if (!S.dir) return null;
  const d = S.dir.replace(/[\\/]+$/, '');
  return d + (wm ? '_con_marca' : '_comprimido');
}

// ================= Grilla =================
const visible = (it) => S.filter === 'all' || it.kind === S.filter;
function frameClass(it) { return it.width >= it.height ? 'frame land' : 'frame port'; }

function renderGrid() {
  const grid = $('grid');
  grid.innerHTML = '';
  const has = S.items.length > 0;
  $('empty').classList.toggle('hidden', has);
  $('toolbar').classList.toggle('hidden', !has);
  const frag = document.createDocumentFragment();
  const groups = new Map();
  S.items.forEach((it, i) => {
    if (!groups.has(it.relDir)) groups.set(it.relDir, []);
    groups.get(it.relDir).push(i);
  });
  const multi = groups.size > 1 || (groups.size === 1 && !groups.has(''));
  for (const [relDir, idxs] of groups) {
    if (multi) {
      const h = document.createElement('div');
      h.className = 'group-head';
      h.dataset.dir = relDir;
      h.innerHTML = `<input type="checkbox" class="ginc" title="Incluir / excluir toda la carpeta">
        <span>📁 ${esc(relDir || '(carpeta principal)')}</span><span class="muted small gcount"></span>`;
      h.querySelector('.ginc').addEventListener('change', (e) => {
        idxs.forEach((i) => { const r = S.items[i].rel; if (e.target.checked) S.excluded.delete(r); else S.excluded.add(r); });
        refreshCards(); persist();
      });
      frag.appendChild(h);
    }
    for (const i of idxs) {
      const it = S.items[i];
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.i = i;
      card.innerHTML = `
        <div class="box"><div class="${frameClass(it)}" style="aspect-ratio:${it.width}/${it.height}">
          <img class="photo" loading="lazy" src="${imgURL(it.path, 480)}" alt="">
          <img class="logo" alt="">
        </div>${it.kind === 'video' ? `<span class="vbadge">▶ ${fmtDur(it.duration)}</span>` : ''}</div>
        <div class="meta">
          <input type="checkbox" class="inc" title="Incluir en exportación">
          <span class="ellipsis grow" title="${esc(it.rel)}">${esc(it.name)}</span>
          <span class="badge hidden">Ajustada</span>
        </div>`;
      card.querySelector('.inc').addEventListener('click', (e) => { e.stopPropagation(); toggleInclude(it.rel, e.target.checked); });
      card.addEventListener('click', () => openEditor(i));
      frag.appendChild(card);
    }
  }
  grid.appendChild(frag);
  refreshCards();
}

function refreshCards() {
  const wmSrc = S.wm ? imgURL(S.wm.path, 1200) : '';
  document.querySelectorAll('.card').forEach((card) => {
    const it = S.items[+card.dataset.i];
    card.classList.toggle('hidden', !visible(it));
    const logo = card.querySelector('.logo');
    if (S.wm && logo.dataset.src !== wmSrc) { logo.src = wmSrc; logo.dataset.src = wmSrc; }
    placeLogo(logo, it);
    const inc = !S.excluded.has(it.rel);
    card.querySelector('.inc').checked = inc;
    card.classList.toggle('excluded', !inc);
    card.querySelector('.badge').classList.toggle('hidden', !(S.wmOn && S.overrides[it.rel]));
  });
  document.querySelectorAll('.group-head').forEach((h) => {
    const its = S.items.filter((it) => it.relDir === h.dataset.dir);
    const vis = its.filter(visible);
    h.classList.toggle('hidden', !vis.length);
    const inc = its.filter((it) => !S.excluded.has(it.rel)).length;
    const cb = h.querySelector('.ginc');
    cb.checked = inc === its.length; cb.indeterminate = inc > 0 && inc < its.length;
    const nP = its.filter((x) => x.kind === 'image').length, nV = its.length - nP;
    h.querySelector('.gcount').textContent = [nP && `${nP} foto${nP > 1 ? 's' : ''}`, nV && `${nV} video${nV > 1 ? 's' : ''}`].filter(Boolean).join(' · ');
  });
  updateCounts();
}

function updateCounts() {
  const inc = S.items.filter((i) => !S.excluded.has(i.rel));
  const nP = inc.filter((i) => i.kind === 'image').length, nV = inc.length - nP;
  const tP = S.items.filter((i) => i.kind === 'image').length, tV = S.items.length - tP;
  const folders = new Set(S.items.map((i) => i.relDir)).size;
  $('countLabel').textContent = `${tP} fotos · ${tV} videos` + (folders > 1 ? ` · ${folders} carpetas` : '') + ` — ${inc.length} para exportar`;
  const parts = [nP && `${nP} foto${nP > 1 ? 's' : ''}`, nV && `${nV} video${nV > 1 ? 's' : ''}`].filter(Boolean);
  const btn = $('btnExport');
  const needLogo = S.wmOn && !S.wm;
  btn.textContent = parts.length ? `Exportar ${parts.join(' y ')}` : 'Exportar';
  btn.disabled = !inc.length || needLogo;
  btn.title = needLogo ? 'Elige el logo o desactiva la marca de agua' : '';
  const od = outDir();
  $('outLabel').textContent = od || '—';
  $('outLabel').title = od || '';
  $('btnOutReset').classList.toggle('hidden', !S.outDirCustom);
}

function toggleInclude(rel, on) {
  if (on) S.excluded.delete(rel); else S.excluded.add(rel);
  refreshCards();
  persist();
}

// ================= Carpeta / logo =================
async function openFolder(dir) {
  if (!dir) return;
  rememberFolder();
  $('empty').classList.add('hidden');
  $('scanning').classList.remove('hidden');
  $('grid').innerHTML = '';
  const mem = S.folders[dir] || {};
  const d = dir.replace(/[\\/]+$/, '');
  const res = await api.scanFolder(dir, [d + '_con_marca', d + '_comprimido', mem.outDirCustom]);
  $('scanning').classList.add('hidden');
  if (!res) { toast('No se pudo abrir esa carpeta.'); renderGrid(); return; }
  S.dir = res.dir;
  S.items = res.items;
  const m2 = S.folders[res.dir] || {};
  S.overrides = m2.overrides || {};
  S.excluded = new Set(m2.excluded || []);
  S.outDirCustom = m2.outDirCustom || null;
  $('folderLabel').textContent = res.dir;
  $('folderLabel').title = res.dir;
  $('btnRescan').classList.remove('hidden');
  renderGrid();
  if (!res.items.length) toast('No se encontraron fotos ni videos en esa carpeta.');
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

// ================= Posición 3x3 =================
function buildAnchorGrid(el, onPick) {
  el.innerHTML = '';
  const names = { tl: 'Arriba izq.', t: 'Arriba', tr: 'Arriba der.', l: 'Izquierda', c: 'Centro', r: 'Derecha', bl: 'Abajo izq.', b: 'Abajo', br: 'Abajo der.' };
  Object.keys(ANCHORS).forEach((k) => {
    const b = document.createElement('button');
    b.dataset.a = k; b.title = names[k];
    b.addEventListener('click', () => onPick(k));
    el.appendChild(b);
  });
}
function markAnchor(el, a) { el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.a === a)); }

// ================= Panel izquierdo =================
function syncGlobalUI() {
  const g = S.global;
  $('wmOn').checked = S.wmOn;
  $('wmBody').classList.toggle('dim', !S.wmOn);
  $('wmOffNote').classList.toggle('hidden', S.wmOn);
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

const PHOTO_HINTS = {
  0: 'Resolución original y máxima calidad. Archivos pesados.',
  custom: ''
};
function photoHint() {
  const kb = photoMaxKB();
  if (S.photo.format === 'png') return '';
  if (!kb) return PHOTO_HINTS[0];
  // Valores medidos con una foto real de 24 MP (6000 px)
  const ref = { 100: '~1400 px', 300: '~2200 px', 500: '~2800 px', 1024: '~4000 px', 2048: 'resolución completa', 3072: 'resolución completa', 5120: 'resolución completa' };
  const size = ref[kb] || (kb < 2048 ? 'resolución reducida según el peso' : 'resolución completa');
  let txt = `Foto de 24 MP → ${size}, calidad JPG alta (80+). Se reduce la resolución antes que dejar bandas o bloques.`;
  if (kb <= 150) txt += ' Ideal para ver en celular; al hacer zoom se nota.';
  else if (kb <= 600) txt += ' Se ve bien en pantalla completa de laptop o celular.';
  else if (kb < 2048) txt += ' Buena para web; permite algo de zoom.';
  else txt += ' Visualmente igual al original.';
  return txt;
}
const VIDEO_HINTS = {
  max: 'Calidad constante muy alta (CRF 18): visualmente idéntico al original. Reduce mucho los videos de cámara o celular.',
  high: 'CRF 21: diferencia imperceptible y bastante más liviano.',
  balanced: 'CRF 23, el estándar de HandBrake. Muy buena calidad y buen peso.',
  light: 'CRF 27: para WhatsApp/Drive. En celular casi no se nota.',
  tiny: 'CRF 31: solo para previews rápidas.',
  target: 'Ajusta el bitrate para que cada video pese aprox. eso (2 pasadas, tarda el doble). Si el peso es muy bajo para la duración, se verá pixelado.'
};

function syncExportUI() {
  const p = S.photo, v = S.video;
  document.querySelectorAll('input[name=fmt]').forEach((r) => { r.checked = r.value === p.format; });
  $('jpgOnly').classList.toggle('hidden', p.format !== 'jpg');
  $('limitPreset').value = p.limitPreset;
  $('customKBRow').classList.toggle('hidden', p.limitPreset !== 'custom');
  $('limitKB').value = p.limitKB;
  $('limitHint').textContent = photoHint();
  $('quality').value = p.quality; $('qualityVal').textContent = p.quality;
  $('resizeOn').checked = p.resizeOn; $('maxEdge').value = p.maxEdge; $('maxEdge').disabled = !p.resizeOn;
  $('vQuality').value = v.quality;
  $('targetRow').classList.toggle('hidden', v.quality !== 'target');
  $('vTargetMB').value = v.targetMB;
  $('vHint').textContent = VIDEO_HINTS[v.quality] || '';
  $('vCodec').value = v.codec; $('vRes').value = v.res; $('vSpeed').value = v.speed;
}
function onExportChange() {
  syncExportUI();
  persist();
  if (S.current >= 0) { markResultStale(); }
}

// ================= Editor =================
const currentItem = () => S.items[S.current];

function openEditor(i) {
  S.current = i;
  S.view = 'edit';
  $('editor').classList.remove('hidden');
  renderEditor(true);
}
function closeEditor() {
  S.current = -1;
  $('editor').classList.add('hidden');
  refreshCards();
}

let resultCache = null;  // { key, data }
let resultBusy = false;

function fitEditorFrame() {
  const it = currentItem(); if (!it) return;
  const stage = $('stage');
  const f = $('edFrame');
  stage.classList.toggle('zoom', S.zoom100);
  let w = it.width, h = it.height;
  if (S.view === 'out' && resultCache && resultCache.data) { w = resultCache.data.width; h = resultCache.data.height; }
  if (S.zoom100) {
    const dpr = window.devicePixelRatio || 1;
    f.style.width = Math.round(w / dpr) + 'px';
    f.style.height = Math.round(h / dpr) + 'px';
  } else {
    const aw = stage.clientWidth - 140, ah = stage.clientHeight - 56;
    const k = Math.min(aw / w, ah / h);
    f.style.width = Math.round(w * k) + 'px';
    f.style.height = Math.round(h * k) + 'px';
  }
}

function renderEditor(newItem) {
  const it = currentItem(); if (!it) return;
  const isVideo = it.kind === 'video';
  if (newItem) {
    resultCache = null;
    if (isVideo) { S.view = 'edit'; S.zoom100 = false; }
    $('vidInfo').textContent = '';
  }
  const photo = $('edPhoto');
  let src;
  if (S.view === 'orig') src = imgURL(it.path, 0);
  else if (S.view === 'out') src = resultCache && resultCache.data ? resultCache.data.url : imgURL(it.path, 480);
  else src = imgURL(it.path, isVideo ? 1600 : 2000);
  if (newItem && S.view === 'edit') {
    photo.src = imgURL(it.path, 480); // la miniatura ya está en caché: aparece al instante
    const hi = new Image(); const target = it.path;
    hi.onload = () => { if (currentItem() && currentItem().path === target && S.view === 'edit') photo.src = hi.src; };
    hi.src = src;
  } else if (photo.getAttribute('src') !== src) photo.src = src;

  fitEditorFrame();
  const logo = $('edLogo');
  if (S.wm) logo.src = imgURL(S.wm.path, 1200);
  if (S.view === 'edit') placeLogo(logo, it); else logo.style.display = 'none';

  const s = settingsFor(it);
  const custom = !!S.overrides[it.rel];
  $('edName').textContent = it.name;
  $('edFolder').textContent = it.relDir ? '📁 ' + it.relDir : '';
  $('edInfo').textContent = `${it.width} × ${it.height} px · ${fmtBytes(it.bytes)}` + (isVideo ? ` · ${fmtDur(it.duration)}` : '') +
    ` · ${S.current + 1} de ${S.items.length}`;
  $('edWm').classList.toggle('dim', !S.wmOn || !S.wm);
  $('edMode').textContent = !S.wmOn ? 'Marca de agua desactivada' : custom ? 'Ajuste propio (solo este archivo)' : 'Usando ajuste general';
  $('edMode').className = 'pill' + (custom && S.wmOn ? ' custom' : '');
  $('eScale').value = s.scale; $('eScaleVal').textContent = Math.round(s.scale) + '%';
  $('eOpacity').value = s.opacity; $('eOpacityVal').textContent = s.opacity + '%';
  $('eMargin').value = s.margin; $('eMarginVal').textContent = s.margin + '%';
  markAnchor($('eAnchor'), s.anchor);
  $('edInclude').checked = !S.excluded.has(it.rel);
  $('edReset').disabled = !custom;

  $('cmpBox').classList.toggle('hidden', isVideo);
  $('vidBox').classList.toggle('hidden', !isVideo);
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.view));
  $('zoom100').checked = S.zoom100;
  const msg = $('stageMsg');
  msg.classList.toggle('hidden', S.view === 'edit');
  msg.textContent = S.view === 'orig' ? 'ORIGINAL' : resultBusy ? 'Calculando resultado…' : 'RESULTADO EXPORTADO';
  if (!isVideo && S.view === 'edit') $('cmpInfo').innerHTML = 'Elige <b>Resultado</b> para ver la foto tal como se exportará. Activa 100% para revisar bandas de color o bloques.';
}

function resultKey(it) { return JSON.stringify(buildJob([it])); }

async function computeResult() {
  const it = currentItem(); if (!it || it.kind !== 'image') return;
  const key = resultKey(it);
  if (resultCache && resultCache.key === key && resultCache.data) { showResultInfo(); renderEditor(); return; }
  resultBusy = true; renderEditor();
  $('cmpInfo').textContent = 'Calculando…';
  const job = buildJob([it]);
  try {
    const data = await api.previewImage(job.items[0], job);
    if (currentItem() !== it) return;
    resultCache = { key, data };
  } catch (e) {
    $('cmpInfo').textContent = 'Error: ' + e.message;
  }
  resultBusy = false;
  showResultInfo();
  renderEditor();
}

function showResultInfo() {
  const it = currentItem(); const d = resultCache && resultCache.data; if (!d) return;
  const ratio = it.bytes ? Math.round((1 - d.bytes / it.bytes) * 100) : 0;
  const sameRes = d.width === it.width && d.height === it.height;
  $('cmpInfo').innerHTML = `Resultado: <b>${fmtBytes(d.bytes)}</b> (original ${fmtBytes(it.bytes)}${ratio > 0 ? `, −${ratio}%` : ''})<br>` +
    `Resolución: <b>${d.width} × ${d.height}</b>${sameRes ? ' (igual al original)' : ` (original ${it.width} × ${it.height})`}<br>` +
    (d.quality ? `Calidad JPG usada: <b>${d.quality}</b>${d.quality >= 85 ? ' — sin pérdida visible' : d.quality >= 70 ? ' — pérdida leve' : ' — compresión fuerte, revisa al 100%'}` : 'PNG sin pérdida');
}

let staleTimer = null;
function markResultStale() {
  if (S.view !== 'out') return;
  clearTimeout(staleTimer);
  staleTimer = setTimeout(computeResult, 450);
}

function editOverride(patch) {
  const it = currentItem(); if (!it) return;
  const base = S.overrides[it.rel] || { ...S.global };
  S.overrides[it.rel] = { ...base, ...patch };
  renderEditor();
  markResultStale();
  persist();
}

function navEditor(d) {
  const list = S.items.map((it, i) => i).filter((i) => visible(S.items[i]));
  if (!list.length) return;
  const pos = list.indexOf(S.current);
  S.current = list[(pos + d + list.length) % list.length];
  const keepView = S.view;
  renderEditor(true);
  if (keepView === 'out' && currentItem().kind === 'image') { S.view = 'out'; computeResult(); }
  else if (keepView === 'orig' && currentItem().kind === 'image') { S.view = 'orig'; renderEditor(); }
}

// Arrastrar el logo / desplazar al 100%
(function setupDrag() {
  const logo = $('edLogo');
  let drag = null;
  logo.addEventListener('pointerdown', (e) => {
    const it = currentItem(); if (!it || !S.wm || !S.wmOn || S.view !== 'edit') return;
    const fr = $('edFrame').getBoundingClientRect();
    const b = layout(it, settingsFor(it));
    drag = { x: e.clientX, y: e.clientY, fr, cx: b.l + b.w / 2, cy: b.t + b.h / 2 };
    logo.setPointerCapture(e.pointerId);
    e.preventDefault(); e.stopPropagation();
  });
  logo.addEventListener('pointermove', (e) => {
    if (!drag) return;
    editOverride({ anchor: null, cx: drag.cx + (e.clientX - drag.x) / drag.fr.width, cy: drag.cy + (e.clientY - drag.y) / drag.fr.height });
  });
  const end = () => { drag = null; };
  logo.addEventListener('pointerup', end);
  logo.addEventListener('pointercancel', end);
  logo.addEventListener('wheel', (e) => {
    e.preventDefault();
    const s = settingsFor(currentItem());
    editOverride({ scale: Math.max(2, Math.min(100, s.scale + (e.deltaY < 0 ? 1 : -1))) });
  }, { passive: false });

  const stage = $('stage');
  let pan = null;
  stage.addEventListener('pointerdown', (e) => {
    if (!S.zoom100 || e.target === logo || e.target.classList.contains('nav')) return;
    pan = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pan) return;
    stage.scrollLeft = pan.sl - (e.clientX - pan.x);
    stage.scrollTop = pan.st - (e.clientY - pan.y);
  });
  stage.addEventListener('pointerup', () => { pan = null; });
})();

// ================= Exportación =================
async function doExport() {
  if (S.wmOn && !S.wm) return toast('Elige el logo o desactiva la marca de agua.');
  const its = S.items.filter((i) => !S.excluded.has(i.rel));
  if (!its.length) return;
  const job = buildJob(its);
  $('progTitle').textContent = 'Exportando…';
  $('progBar').style.width = '0%';
  $('fileBar').style.width = '0%';
  $('fileBarWrap').classList.remove('hidden');
  $('progText').textContent = `0 de ${its.length}`;
  $('progActions').innerHTML = '';
  const cancel = document.createElement('button');
  cancel.className = 'btn'; cancel.textContent = 'Cancelar';
  cancel.onclick = () => { cancel.disabled = true; cancel.textContent = 'Cancelando…'; api.cancelExport(); };
  $('progActions').append(cancel);
  $('progress').classList.remove('hidden');
  const t0 = performance.now();
  const res = await api.exportItems(job);
  const secs = (performance.now() - t0) / 1000;
  const ok = res.done - res.errors.length;
  $('fileBarWrap').classList.add('hidden');
  $('progBar').style.width = '100%';
  $('progTitle').textContent = res.canceled ? 'Exportación cancelada' : res.errors.length ? 'Terminado con errores' : '¡Listo!';
  const saved = res.inBytes ? Math.round((1 - res.outBytes / res.inBytes) * 100) : 0;
  $('progText').innerHTML = `${ok} archivo${ok === 1 ? '' : 's'} guardado${ok === 1 ? '' : 's'} en ${secs >= 90 ? Math.round(secs / 60) + ' min' : secs.toFixed(1) + ' s'}` +
    (res.inBytes ? `<br>Peso total: ${fmtBytes(res.inBytes)} → <b>${fmtBytes(res.outBytes)}</b>${saved > 0 ? ` (−${saved}%)` : ''}` : '') +
    `<br><span class="ellipsis">${esc(res.outDir)}</span>` +
    (res.errors.length ? `<br><br>No se pudieron exportar:<br>${res.errors.map((e) => `• ${esc(e.name)}: ${esc(e.message)}`).join('<br>')}` : '');
  $('progActions').innerHTML = '';
  const open = document.createElement('button');
  open.className = 'btn primary'; open.textContent = 'Abrir carpeta';
  open.onclick = () => api.openPath(res.outDir);
  const close = document.createElement('button');
  close.className = 'btn'; close.textContent = 'Cerrar';
  close.onclick = () => $('progress').classList.add('hidden');
  $('progActions').append(close, open);
}
api.onExportProgress((d) => {
  const frac = d.frac >= 1 ? 0 : d.frac || 0;
  $('progBar').style.width = ((d.done + frac) / d.total) * 100 + '%';
  $('fileBar').style.width = (d.frac || 0) * 100 + '%';
  $('progText').textContent = `${d.done} de ${d.total} — ${d.name}` + (d.frac > 0 && d.frac < 1 ? ` (${Math.round(d.frac * 100)}%)` : '');
});

// ================= Actualizaciones =================
let manualCheck = false;
function showUpdate(d) {
  const box = $('updateBox');
  box.className = 'update';
  if (d.state === 'available') {
    box.innerHTML = `Nueva versión ${esc(d.version)} disponible <button class="btn primary">Actualizar</button>`;
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
api.onUpdate(showUpdate);

// ================= Toast =================
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3800);
}

// ================= Eventos =================
function bind() {
  const pick = async () => openFolder(await api.pickFolder());
  $('btnFolder').onclick = pick;
  $('btnFolder2').onclick = pick;
  $('btnRescan').onclick = () => openFolder(S.dir);
  $('logoPreview').onclick = async () => setWatermark(await api.pickWatermark());
  $('thumbSize').oninput = (e) => { S.thumb = +e.target.value; $('grid').style.setProperty('--thumb', S.thumb + 'px'); persist(); };

  $('wmOn').onchange = (e) => { S.wmOn = e.target.checked; onGlobalChange(); markResultStale(); };
  $('gScale').oninput = (e) => { S.global.scale = +e.target.value; onGlobalChange(); markResultStale(); };
  $('gOpacity').oninput = (e) => { S.global.opacity = +e.target.value; onGlobalChange(); markResultStale(); };
  $('gMargin').oninput = (e) => { S.global.margin = +e.target.value; onGlobalChange(); markResultStale(); };
  buildAnchorGrid($('gAnchor'), (a) => { S.global.anchor = a; onGlobalChange(); markResultStale(); });
  $('btnResetAll').onclick = () => {
    if (!Object.keys(S.overrides).length) return toast('No hay ajustes individuales.');
    if (confirm('¿Quitar los ajustes individuales de todos los archivos y usar el ajuste general?')) { S.overrides = {}; refreshCards(); persist(); }
  };

  // Fotos
  document.querySelectorAll('input[name=fmt]').forEach((r) => r.onchange = () => { S.photo.format = r.value; onExportChange(); });
  $('limitPreset').onchange = (e) => { S.photo.limitPreset = e.target.value; onExportChange(); };
  $('limitKB').onchange = (e) => { S.photo.limitKB = +e.target.value; onExportChange(); };
  $('quality').oninput = (e) => { S.photo.quality = +e.target.value; $('qualityVal').textContent = S.photo.quality; persist(); markResultStale(); };
  $('resizeOn').onchange = (e) => { S.photo.resizeOn = e.target.checked; onExportChange(); };
  $('maxEdge').onchange = (e) => { S.photo.maxEdge = +e.target.value; onExportChange(); };
  // Videos
  $('vQuality').onchange = (e) => { S.video.quality = e.target.value; onExportChange(); };
  $('vTargetMB').onchange = (e) => { S.video.targetMB = +e.target.value; onExportChange(); };
  $('vCodec').onchange = (e) => { S.video.codec = e.target.value; onExportChange(); };
  $('vRes').onchange = (e) => { S.video.res = e.target.value; onExportChange(); };
  $('vSpeed').onchange = (e) => { S.video.speed = e.target.value; onExportChange(); };

  $('btnOut').onclick = async () => { const p = await api.pickOutput(outDir() || undefined); if (p) { S.outDirCustom = p; updateCounts(); persist(); } };
  $('btnOutReset').onclick = () => { S.outDirCustom = null; updateCounts(); persist(); };
  $('btnExport').onclick = doExport;

  $('filterSeg').querySelectorAll('button').forEach((b) => b.onclick = () => {
    S.filter = b.dataset.f;
    $('filterSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    refreshCards();
  });
  $('selAll').onclick = () => { S.items.filter(visible).forEach((i) => S.excluded.delete(i.rel)); refreshCards(); persist(); };
  $('selNone').onclick = () => { S.items.filter(visible).forEach((i) => S.excluded.add(i.rel)); refreshCards(); persist(); };

  // Editor
  $('eScale').oninput = (e) => editOverride({ scale: +e.target.value });
  $('eOpacity').oninput = (e) => editOverride({ opacity: +e.target.value });
  $('eMargin').oninput = (e) => editOverride({ margin: +e.target.value });
  buildAnchorGrid($('eAnchor'), (a) => editOverride({ anchor: a }));
  $('edReset').onclick = () => { delete S.overrides[currentItem().rel]; renderEditor(); markResultStale(); persist(); };
  $('edApplyAll').onclick = () => {
    const s = { ...settingsFor(currentItem()) };
    if (!s.anchor) toast('Posición libre: se aplicará la misma ubicación relativa a todos.');
    S.global = s; S.overrides = {};
    syncGlobalUI(); renderEditor(); persist();
  };
  $('edInclude').onchange = (e) => toggleInclude(currentItem().rel, e.target.checked);
  $('edClose').onclick = closeEditor;
  $('prevImg').onclick = () => navEditor(-1);
  $('nextImg').onclick = () => navEditor(1);
  $('viewSeg').querySelectorAll('button').forEach((b) => b.onclick = () => {
    S.view = b.dataset.v;
    if (S.view === 'out') computeResult(); else renderEditor();
  });
  $('zoom100').onchange = (e) => { S.zoom100 = e.target.checked; renderEditor(); };
  $('vidOpen').onclick = () => api.openPath(currentItem().path);
  $('vidEstimate').onclick = async () => {
    const it = currentItem(); const job = buildJob([it]);
    $('vidInfo').textContent = 'Codificando una muestra para estimar…';
    $('vidEstimate').disabled = true;
    const r = await api.estimateVideo(job.items[0], job);
    $('vidEstimate').disabled = false;
    if (currentItem() !== it) return;
    if (r.error) { $('vidInfo').textContent = 'No se pudo estimar: ' + r.error; return; }
    const ratio = Math.round((1 - r.bytes / it.bytes) * 100);
    $('vidInfo').innerHTML = `Peso estimado: <b>~${fmtBytes(r.bytes)}</b> (original ${fmtBytes(it.bytes)}${ratio > 0 ? `, −${ratio}%` : ratio < 0 ? ', más pesado que el original: prueba una compresión mayor' : ''})<br>Resolución final: <b>${r.width} × ${r.height}</b>`;
  };
  $('stage').addEventListener('click', (e) => { if (e.target.id === 'stage' && !S.zoom100) closeEditor(); });
  window.addEventListener('resize', () => { if (S.current >= 0) fitEditorFrame(); });
  document.addEventListener('keydown', (e) => {
    if (S.current < 0 || (e.target.tagName === 'INPUT' && e.target.type === 'number') || e.target.tagName === 'SELECT') return;
    if (e.key === 'Escape') closeEditor();
    if (e.key === 'ArrowLeft') navEditor(-1);
    if (e.key === 'ArrowRight') navEditor(1);
  });

  // Arrastrar carpeta a la ventana
  const main = $('main');
  ['dragenter', 'dragover'].forEach((ev) => main.addEventListener(ev, (e) => { e.preventDefault(); main.classList.add('drop'); }));
  ['dragleave', 'drop'].forEach((ev) => main.addEventListener(ev, () => main.classList.remove('drop')));
  main.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) openFolder(api.pathForFile(f));
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  $('btnVersion').onclick = async () => {
    manualCheck = true;
    const r = await api.checkUpdate();
    if (r.state === 'dev' || r.state === 'error') showUpdate(r);
  };
}

// ================= Inicio =================
(async function init() {
  bind();
  $('version').textContent = await api.version();
  if (!(await api.hasFfmpeg())) $('noFfmpeg').classList.remove('hidden');
  const cfg = await api.loadConfig();
  if (cfg.global) S.global = { ...DEFAULT_GLOBAL, ...cfg.global };
  if (typeof cfg.wmOn === 'boolean') S.wmOn = cfg.wmOn;
  if (cfg.photo) S.photo = { ...S.photo, ...cfg.photo };
  if (cfg.video) S.video = { ...S.video, ...cfg.video };
  if (cfg.folders) S.folders = cfg.folders;
  if (cfg.thumb) { S.thumb = cfg.thumb; $('thumbSize').value = S.thumb; $('grid').style.setProperty('--thumb', S.thumb + 'px'); }
  syncGlobalUI();
  syncExportUI();
  if (cfg.watermarkPath) setWatermark(await api.loadWatermark(cfg.watermarkPath));
  if (cfg.lastDir) await openFolder(cfg.lastDir);
  updateCounts();
})();
