'use strict';
const path = require('path');
const fsp = require('fs').promises;
const sharp = require('sharp');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);

// ---------- Utilidades de imagen ----------
async function orientedSize(p) {
  const m = await sharp(p, { failOn: 'none' }).metadata();
  let w = m.width, h = m.height;
  if (m.orientation && m.orientation >= 5) [w, h] = [h, w];
  return { width: w, height: h };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

async function scanFolder(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const names = entries
    .filter((d) => d.isFile() && IMAGE_EXT.has(path.extname(d.name).toLowerCase()))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const res = await mapLimit(names, 6, async (name) => {
    const p = path.join(dir, name);
    try {
      const { width, height } = await orientedSize(p);
      const st = await fsp.stat(p);
      return { name, path: p, width, height, bytes: st.size };
    } catch {
      return null;
    }
  });
  return { dir, images: res.filter(Boolean) };
}

// ---------- Exportación ----------
async function encodeJpeg(raw, info, quality) {
  return sharp(raw, { raw: info })
    .jpeg({ quality, mozjpeg: true, chromaSubsampling: quality >= 90 ? '4:4:4' : '4:2:0' })
    .toBuffer();
}

// Codificación rápida (sin mozjpeg) solo para medir tamaños durante la búsqueda
async function sizeAt(raw, info, quality) {
  const b = await sharp(raw, { raw: info }).jpeg({ quality, chromaSubsampling: '4:2:0' }).toBuffer();
  return b.length;
}

// Píxeles mínimos de "presupuesto" por byte: con límites muy chicos en fotos enormes
// se reduce la resolución primero (si no, la foto queda muy pixelada por la compresión).
const MIN_BYTES_PER_PIXEL = 0.06;

async function encodeWithLimit(raw, info, maxQuality, maxBytes) {
  let curRaw = raw, curInfo = info;
  const maxPixels = maxBytes / MIN_BYTES_PER_PIXEL;
  if (curInfo.width * curInfo.height > maxPixels) {
    const f = Math.sqrt(maxPixels / (curInfo.width * curInfo.height));
    const r = await sharp(curRaw, { raw: curInfo })
      .resize(Math.round(curInfo.width * f), Math.round(curInfo.height * f))
      .raw().toBuffer({ resolveWithObject: true });
    curRaw = r.data; curInfo = r.info;
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const best = await encodeJpeg(curRaw, curInfo, maxQuality);
    if (best.length <= maxBytes) return best;
    // Búsqueda binaria de la calidad más alta que entra en el límite
    let lo = 30, hi = maxQuality - 1, q = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if ((await sizeAt(curRaw, curInfo, mid)) <= maxBytes) { q = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (q) {
      // Intento final con mozjpeg (comprime mejor): sube la calidad si todavía entra
      let found = null;
      for (let qq = Math.min(maxQuality, q + 4); qq >= q; qq--) {
        const b = await encodeJpeg(curRaw, curInfo, qq);
        if (b.length <= maxBytes) { found = b; break; }
      }
      if (found) return found;
    }
    // Ni con calidad baja entra: reducir resolución y reintentar
    const nw = Math.max(64, Math.round(curInfo.width * 0.85));
    const nh = Math.max(64, Math.round(curInfo.height * 0.85));
    const r = await sharp(curRaw, { raw: curInfo }).resize(nw, nh).raw().toBuffer({ resolveWithObject: true });
    curRaw = r.data; curInfo = r.info;
  }
  return encodeJpeg(curRaw, curInfo, 25);
}

async function buildLogo(wmPath, targetW, targetH, opacity) {
  const { data, info } = await sharp(wmPath, { failOn: 'none' })
    .resize({ width: targetW, height: targetH, fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (opacity < 1) {
    for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * opacity);
  }
  return { data, info };
}

async function exportOne(item, job) {
  const { width: W0, height: H0 } = await orientedSize(item.path);
  let W = W0, H = H0;
  if (job.maxEdge && Math.max(W0, H0) > job.maxEdge) {
    const f = job.maxEdge / Math.max(W0, H0);
    W = Math.round(W0 * f); H = Math.round(H0 * f);
  }

  let img = sharp(item.path, { failOn: 'none' }).rotate();
  if (W !== W0 || H !== H0) img = img.resize(W, H);

  const composites = [];
  if (job.watermarkPath && item.box) {
    let lw = Math.max(1, Math.round(item.box.w * W));
    let lh = Math.max(1, Math.round(item.box.h * H));
    lw = Math.min(lw, W); lh = Math.min(lh, H);
    let left = Math.round(item.box.l * W);
    let top = Math.round(item.box.t * H);
    left = Math.max(0, Math.min(W - lw, left));
    top = Math.max(0, Math.min(H - lh, top));
    const logo = await buildLogo(job.watermarkPath, lw, lh, item.opacity);
    composites.push({ input: logo.data, raw: { width: logo.info.width, height: logo.info.height, channels: 4 }, left, top });
  }
  if (composites.length) img = img.composite(composites);

  const base = path.parse(item.name).name;
  const ext = job.format === 'png' ? '.png' : '.jpg';
  let outPath = path.join(job.outDir, base + ext);
  if (path.resolve(outPath).toLowerCase() === path.resolve(item.path).toLowerCase()) {
    outPath = path.join(job.outDir, base + '_marca' + ext);
  }

  let buf;
  if (job.format === 'png') {
    buf = await img.png({ compressionLevel: 6 }).toBuffer();
  } else {
    img = img.flatten({ background: '#ffffff' });
    if (job.maxKB) {
      const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
      buf = await encodeWithLimit(data, info, job.quality, job.maxKB * 1024);
    } else {
      buf = await img.jpeg({ quality: job.quality, mozjpeg: true, chromaSubsampling: job.quality >= 90 ? '4:4:4' : '4:2:0' }).toBuffer();
    }
  }
  await fsp.writeFile(outPath, buf);
  return { outPath, bytes: buf.length };
}

module.exports = { orientedSize, mapLimit, scanFolder, exportOne };
