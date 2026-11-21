'use strict';
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { spawn } = require('child_process');
const sharp = require('sharp');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm', '.mts', '.m2ts', '.wmv', '.3gp', '.mpg', '.mpeg']);

let FFMPEG = null;
try {
  FFMPEG = require('ffmpeg-static');
  if (FFMPEG) FFMPEG = FFMPEG.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
} catch { FFMPEG = null; }

const kindOf = (p) => {
  const e = path.extname(p).toLowerCase();
  return IMAGE_EXT.has(e) ? 'image' : VIDEO_EXT.has(e) ? 'video' : null;
};

// ---------- Utilidades ----------
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

function semaphore(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, res, rej } = queue.shift();
    fn().then(res, rej).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((res, rej) => { queue.push({ fn, res, rej }); next(); });
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// ---------- ffmpeg ----------
function runFfmpeg(args, { onTime, signal, stdout, cwd } = {}) {
  return new Promise((resolve, reject) => {
    if (!FFMPEG) return reject(new Error('ffmpeg no disponible'));
    const proc = spawn(FFMPEG, args, { windowsHide: true, cwd });
    const chunks = [];
    let errTail = '';
    if (stdout) proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      errTail = (errTail + s).slice(-4000);
      if (onTime) {
        const m = s.match(/time=(\d+):(\d+):([\d.]+)/);
        if (m) onTime(+m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]));
      }
    });
    const onAbort = () => { try { proc.kill('SIGKILL'); } catch {} };
    if (signal) {
      if (signal.aborted) onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (signal && signal.aborted) return reject(new Error('Cancelado'));
      if (code === 0) resolve({ stdout: Buffer.concat(chunks), stderr: errTail });
      else {
        const lines = errTail.trim().split('\n').filter((l) => !/^\s*(frame=|size=)/.test(l));
        reject(Object.assign(new Error(lines.slice(-2).join(' ').trim() || 'ffmpeg falló'), { stderr: errTail }));
      }
    });
  });
}

async function probeVideo(p) {
  let txt = '';
  try { await runFfmpeg(['-hide_banner', '-i', p]); } catch (e) { txt = e.stderr || ''; }
  const d = txt.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const v = txt.match(/Stream #[^\n]*Video:[^\n]*?, (\d{2,5})x(\d{2,5})[ ,\n]/);
  if (!v) throw new Error('No se pudo leer el video');
  let width = +v[1], height = +v[2];
  const rot = txt.match(/rotation of (-?[\d.]+) degrees/) || txt.match(/rotate\s*:\s*(-?\d+)/);
  if (rot && Math.abs(Math.round(+rot[1])) % 180 === 90) [width, height] = [height, width];
  const fps = txt.match(/, ([\d.]+) fps/);
  return {
    width, height,
    duration: d ? +d[1] * 3600 + +d[2] * 60 + parseFloat(d[3]) : 0,
    hasAudio: /Stream #[^\n]*Audio:/.test(txt),
    fps: fps ? parseFloat(fps[1]) : 0
  };
}

const frameLimit = semaphore(3);
function videoFrame(p, size, duration) {
  const t = Math.min(1, (duration || 0) * 0.1).toFixed(2);
  const vf = size > 0 ? ['-vf', `scale=${size}:${size}:force_original_aspect_ratio=decrease`] : [];
  return frameLimit(() => runFfmpeg(['-hide_banner', '-loglevel', 'error', '-ss', t, '-i', p, '-frames:v', '1', ...vf,
    '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '3', '-'], { stdout: true }).then((r) => r.stdout));
}

// ---------- Escaneo (con subcarpetas) ----------
async function orientedSize(p) {
  const m = await sharp(p, { failOn: 'none' }).metadata();
  let w = m.width, h = m.height;
  if (m.orientation && m.orientation >= 5) [w, h] = [h, w];
  return { width: w, height: h };
}

async function walk(root, skip) {
  const files = [];
  const skipSet = new Set((skip || []).filter(Boolean).map((s) => path.resolve(s).toLowerCase()));
  async function rec(dir, depth) {
    if (depth > 12) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const d of entries) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (d.name.startsWith('.') || d.name.startsWith('$')) continue;
        if (skipSet.has(full.toLowerCase())) continue;
        await rec(full, depth + 1);
      } else if (d.isFile() && kindOf(d.name)) {
        files.push(full);
      }
    }
  }
  await rec(root, 0);
  return files;
}

async function scanFolder(root, skip) {
  const files = await walk(root, skip);
  const res = await mapLimit(files, 6, async (p) => {
    const kind = kindOf(p);
    const rel = path.relative(root, p).split(path.sep).join('/');
    const relDir = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
    try {
      const st = await fsp.stat(p);
      const base = { rel, relDir, name: path.basename(p), path: p, kind, bytes: st.size };
      if (kind === 'image') return { ...base, ...(await orientedSize(p)) };
      const v = await probeVideo(p);
      return { ...base, width: v.width, height: v.height, duration: v.duration, hasAudio: v.hasAudio };
    } catch { return null; }
  });
  const items = res.filter(Boolean);
  const coll = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  items.sort((a, b) => coll(a.relDir, b.relDir) || coll(a.name, b.name));
  return { dir: root, items };
}

// ---------- Logo ----------
async function buildLogo(wmPath, targetW, targetH, opacity) {
  const { data, info } = await sharp(wmPath, { failOn: 'none' })
    .resize({ width: targetW, height: targetH, fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (opacity < 1) for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * opacity);
  return { data, info };
}

function logoRect(box, W, H) {
  let lw = Math.max(2, Math.round(box.w * W));
  let lh = Math.max(2, Math.round(box.h * H));
  lw = Math.min(lw, W); lh = Math.min(lh, H);
  const left = Math.max(0, Math.min(W - lw, Math.round(box.l * W)));
  const top = Math.max(0, Math.min(H - lh, Math.round(box.t * H)));
  return { lw, lh, left, top };
}

// ---------- Fotos ----------
const jpegOpts = (q) => ({ quality: q, mozjpeg: true, chromaSubsampling: q >= 90 ? '4:4:4' : '4:2:0' });
const encodeJpeg = (raw, info, q) => sharp(raw, { raw: info }).jpeg(jpegOpts(q)).toBuffer();
const sizeAt = async (raw, info, q) => (await sharp(raw, { raw: info }).jpeg({ quality: q }).toBuffer()).length;

// Estrategia (como Lightroom pero priorizando que no aparezcan bandas/bloques):
// 1) se busca la calidad JPG más alta que entra en el peso;
// 2) si esa calidad queda por debajo de MIN_GOOD_QUALITY, se reduce un poco la
//    resolución y se vuelve a intentar. Es mejor una foto algo más chica y limpia
//    que una a tamaño completo con artefactos.
const MIN_GOOD_QUALITY = 75;
const START_BYTES_PER_PIXEL = 0.09;
const MIN_SIDE = 900;

async function resizeRaw(raw, info, f) {
  const r = await sharp(raw, { raw: info }).resize(Math.max(64, Math.round(info.width * f)), Math.max(64, Math.round(info.height * f)))
    .raw().toBuffer({ resolveWithObject: true });
  return [r.data, r.info];
}

// Mayor calidad (libjpeg rápido) cuyo peso entra; 0 si ni con 30 entra
async function bestQuality(raw, info, maxQuality, maxBytes) {
  if ((await sizeAt(raw, info, maxQuality)) <= maxBytes) return maxQuality;
  let lo = 30, hi = maxQuality - 1, q = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await sizeAt(raw, info, mid)) <= maxBytes) { q = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return q;
}

async function encodeWithLimit(raw, info, maxQuality, maxBytes) {
  let curRaw = raw, curInfo = info;
  const startPixels = maxBytes / START_BYTES_PER_PIXEL;
  if (curInfo.width * curInfo.height > startPixels) {
    [curRaw, curInfo] = await resizeRaw(curRaw, curInfo, Math.sqrt(startPixels / (curInfo.width * curInfo.height)));
  }
  let q = 0;
  for (let attempt = 0; attempt < 10; attempt++) {
    q = await bestQuality(curRaw, curInfo, maxQuality, maxBytes);
    const canShrink = Math.min(curInfo.width, curInfo.height) * 0.88 >= MIN_SIDE;
    if (q >= Math.min(MIN_GOOD_QUALITY, maxQuality) || (q && !canShrink)) break;
    if (!canShrink && !q) { [curRaw, curInfo] = await resizeRaw(curRaw, curInfo, 0.8); continue; }
    [curRaw, curInfo] = await resizeRaw(curRaw, curInfo, 0.88);
  }
  // mozjpeg comprime ~10% mejor que libjpeg: se aprovecha para subir la calidad final
  for (let qq = Math.min(maxQuality, (q || 30) + 6); qq >= (q || 30); qq -= 2) {
    const b = await encodeJpeg(curRaw, curInfo, qq);
    if (b.length <= maxBytes || qq <= (q || 30)) return { buf: b, quality: qq, width: curInfo.width, height: curInfo.height };
  }
  return { buf: await encodeJpeg(curRaw, curInfo, q || 30), quality: q || 30, width: curInfo.width, height: curInfo.height };
}

// Devuelve { buf, quality, width, height } sin escribir a disco
async function renderImage(item, job) {
  const { width: W0, height: H0 } = await orientedSize(item.path);
  let W = W0, H = H0;
  const p = job.photo;
  if (p.maxEdge && Math.max(W0, H0) > p.maxEdge) {
    const f = p.maxEdge / Math.max(W0, H0);
    W = Math.round(W0 * f); H = Math.round(H0 * f);
  }
  let img = sharp(item.path, { failOn: 'none', limitInputPixels: false }).rotate();
  if (W !== W0 || H !== H0) img = img.resize(W, H);

  if (job.watermarkPath && item.box) {
    const r = logoRect(item.box, W, H);
    const logo = await buildLogo(job.watermarkPath, r.lw, r.lh, item.opacity);
    img = img.composite([{ input: logo.data, raw: { width: logo.info.width, height: logo.info.height, channels: 4 }, left: r.left, top: r.top }]);
  }

  if (p.format === 'png') {
    return { buf: await img.png({ compressionLevel: 6 }).toBuffer(), quality: null, width: W, height: H };
  }
  img = img.flatten({ background: '#ffffff' });
  if (p.maxKB) {
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    return encodeWithLimit(data, info, p.quality, p.maxKB * 1024);
  }
  return { buf: await img.jpeg(jpegOpts(p.quality)).toBuffer(), quality: p.quality, width: W, height: H };
}

async function exportImage(item, job, outBase) {
  const r = await renderImage(item, job);
  const outPath = outBase + (job.photo.format === 'png' ? '.png' : '.jpg');
  await fsp.writeFile(outPath, r.buf);
  return { outPath, bytes: r.buf.length };
}

// ---------- Videos ----------
// Calidad tipo HandBrake: CRF (calidad constante). Menor número = más calidad y más peso.
const CRF = { max: 18, high: 21, balanced: 23, light: 27, tiny: 31 };
const AUDIO_KBPS = 160;

async function videoPlan(item, job, tmpDir) {
  const v = job.video;
  const info = await probeVideo(item.path);
  const W0 = info.width, H0 = info.height;
  let f = 1;
  if (v.res && v.res !== 'orig') f = Math.min(1, +v.res / Math.min(W0, H0));
  const W = even(W0 * f), H = even(H0 * f);

  const inputs = ['-i', item.path];
  let filter = `[0:v]scale=${W}:${H}:flags=lanczos,setsar=1`;
  if (job.watermarkPath && item.box) {
    const r = logoRect(item.box, W, H);
    const logo = await buildLogo(job.watermarkPath, r.lw, r.lh, item.opacity);
    const logoPath = path.join(tmpDir, 'logo.png');
    await sharp(logo.data, { raw: { width: logo.info.width, height: logo.info.height, channels: 4 } }).png().toFile(logoPath);
    inputs.push('-i', logoPath);
    filter += `[b];[b][1:v]overlay=${r.left}:${r.top}`;
  }
  filter += ',format=yuv420p[v]';
  return { info, W, H, inputs, filter };
}

function codecArgs(v, { crf, bitrate, pass, passlog }) {
  const preset = v.speed || 'medium';
  if (v.codec === 'h265') {
    const xp = [];
    if (pass) xp.push(`pass=${pass}`, 'stats=x265pass.log', 'log-level=error');
    else xp.push('log-level=error');
    return ['-c:v', 'libx265', '-preset', preset, ...(bitrate ? ['-b:v', bitrate + 'k'] : ['-crf', String(crf + 5)]),
      '-x265-params', xp.join(':'), '-tag:v', 'hvc1'];
  }
  return ['-c:v', 'libx264', '-preset', preset, '-profile:v', 'high',
    ...(bitrate ? ['-b:v', bitrate + 'k', ...(pass ? ['-pass', String(pass), '-passlogfile', passlog] : [])] : ['-crf', String(crf)])];
}

function targetBitrate(v, info) {
  if (v.quality !== 'target' || !info.duration) return 0;
  const audio = info.hasAudio ? AUDIO_KBPS : 0;
  return Math.max(250, Math.floor(((v.targetMB || 50) * 8192 * 0.97) / info.duration - audio));
}

async function exportVideo(item, job, outBase, { onProgress, signal } = {}) {
  const v = job.video;
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mda-'));
  const outPath = outBase + '.mp4';
  try {
    const plan = await videoPlan(item, job, tmpDir);
    const dur = plan.info.duration || 1;
    const bitrate = targetBitrate(v, plan.info);
    const crf = CRF[v.quality] || CRF.balanced;
    const audio = plan.info.hasAudio ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', AUDIO_KBPS + 'k'] : ['-an'];
    const common = ['-hide_banner', '-y', ...plan.inputs, '-filter_complex', plan.filter, '-map', '[v]'];
    const passlog = path.join(tmpDir, 'pass');
    if (bitrate) {
      await runFfmpeg([...common, ...codecArgs(v, { bitrate, pass: 1, passlog }), '-an', '-f', 'mp4', os.platform() === 'win32' ? 'NUL' : '/dev/null'],
        { signal, cwd: tmpDir, onTime: (t) => onProgress && onProgress(Math.min(1, t / dur) * 0.5) });
      await runFfmpeg([...common, ...codecArgs(v, { bitrate, pass: 2, passlog }), ...audio, '-map_metadata', '0', '-movflags', '+faststart', outPath],
        { signal, cwd: tmpDir, onTime: (t) => onProgress && onProgress(0.5 + Math.min(1, t / dur) * 0.5) });
    } else {
      await runFfmpeg([...common, ...codecArgs(v, { crf }), ...audio, '-map_metadata', '0', '-movflags', '+faststart', outPath],
        { signal, onTime: (t) => onProgress && onProgress(Math.min(1, t / dur)) });
    }
    const st = await fsp.stat(outPath);
    return { outPath, bytes: st.size };
  } catch (e) {
    await fsp.rm(outPath, { force: true }).catch(() => {});
    throw e;
  } finally {
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Estima el peso final codificando una muestra corta del medio del video
async function estimateVideo(item, job) {
  const v = job.video;
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mda-'));
  try {
    const plan = await videoPlan(item, job, tmpDir);
    const dur = plan.info.duration;
    const bitrate = targetBitrate(v, plan.info);
    if (bitrate) return { bytes: Math.round((bitrate + (plan.info.hasAudio ? AUDIO_KBPS : 0)) * 128 * dur), width: plan.W, height: plan.H, exact: false };
    const sample = Math.min(6, dur || 6);
    const start = Math.max(0, dur / 2 - sample / 2);
    const out = path.join(tmpDir, 'sample.mp4');
    const crf = CRF[v.quality] || CRF.balanced;
    await runFfmpeg(['-hide_banner', '-y', '-ss', start.toFixed(2), '-t', sample.toFixed(2), ...plan.inputs.slice(0, 2),
      ...plan.inputs.slice(2), '-filter_complex', plan.filter, '-map', '[v]', ...codecArgs(v, { crf }), '-an', out]);
    const st = await fsp.stat(out);
    const videoBytes = (st.size / sample) * dur;
    const audioBytes = plan.info.hasAudio ? AUDIO_KBPS * 128 * dur : 0;
    return { bytes: Math.round(videoBytes + audioBytes), width: plan.W, height: plan.H, exact: false };
  } finally {
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  FFMPEG, IMAGE_EXT, VIDEO_EXT, kindOf, mapLimit, orientedSize, probeVideo, videoFrame,
  scanFolder, renderImage, exportImage, exportVideo, estimateVideo
};
