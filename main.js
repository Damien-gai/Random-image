const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const { pathToFileURL } = require('url');
const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const yauzl = require('yauzl');

/* Autorise la lecture auto des vidéos et le HEVC quand le matériel le permet */
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');

const tmpRoot = path.join(app.getPath('temp'), 'image-aleatoire-' + process.pid);
const mediaDir = path.join(tmpRoot, 'media');
let win;

/* ---------- Formats ---------- */
const IMG_NATIVE = /\.(jpe?g|jfif|png|apng|gif|webp|avif|bmp|svg|ico)$/i;
const IMG_CONV = /\.(heic|heif|tiff?|jp2|j2k|tga|ppm|pgm|pbm|pcx)$/i;       // convertis en JPEG
const VID_NATIVE = /\.(mp4|m4v|webm|ogv|mov)$/i;                              // lus directement
const VID_CONV = /\.(mkv|avi|wmv|flv|mpe?g|mpg|3gp|3g2|ts|mts|m2ts|vob|asf|divx|rm|rmvb|ogm|f4v|mxf|wtv)$/i; // convertis

function classify(p) {
  if (IMG_NATIVE.test(p)) return { kind: 'image', needs: null };
  if (IMG_CONV.test(p)) return { kind: 'image', needs: 'img' };
  if (VID_NATIVE.test(p)) return { kind: 'video', needs: null };
  if (VID_CONV.test(p)) return { kind: 'video', needs: 'vid' };
  return null;
}

/* ---------- Scan de dossiers + dédoublonnage par contenu ---------- */
function walk(p, out) {
  let st;
  try { st = fs.statSync(p); } catch { return; }
  if (st.isDirectory()) {
    let items = [];
    try { items = fs.readdirSync(p); } catch { return; }
    for (const n of items) walk(path.join(p, n), out);
  } else if (classify(p)) {
    out.push({ p, size: st.size });
  }
}

// Empreinte = taille + début (64 Ko) + fin (16 Ko) du fichier. Stable même si le fichier est déplacé.
async function fingerprint(p, size) {
  const h = crypto.createHash('sha1');
  let fh;
  try {
    fh = await fsp.open(p, 'r');
    const head = Buffer.alloc(Math.min(65536, size));
    await fh.read(head, 0, head.length, 0);
    h.update(head);
    if (size > 65536) {
      const n = Math.min(16384, size - 65536);
      const tail = Buffer.alloc(n);
      await fh.read(tail, 0, n, size - n);
      h.update(tail);
    }
  } catch { h.update(p); } finally { if (fh) await fh.close().catch(() => {}); }
  return size.toString(36) + '-' + h.digest('hex').slice(0, 16);
}

async function scanMany(paths) {
  const files = [];
  for (const p of paths) walk(p, files);
  files.sort((a, b) => (a.p < b.p ? -1 : 1));
  const keys = new Array(files.length);
  let i = 0;
  await Promise.all(Array.from({ length: 24 }, async () => {
    while (i < files.length) { const k = i++; keys[k] = await fingerprint(files[k].p, files[k].size); }
  }));
  const seen = new Set(), out = [];
  files.forEach((f, k) => {
    if (seen.has(keys[k])) return;           // doublon exact : ignoré
    seen.add(keys[k]);
    const c = classify(f.p);
    out.push({ name: path.basename(f.p), dir: path.dirname(f.p), path: f.p, url: pathToFileURL(f.p).href,
               size: f.size, kind: c.kind, needs: c.needs, key: keys[k] });
  });
  return out;
}

/* ---------- ZIP ---------- */
function extractZip(zipPath, dest) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zf) => {
      if (err) return reject(err);
      zf.on('error', reject);
      zf.on('end', resolve);
      zf.on('entry', (e) => {
        if (/\/$/.test(e.fileName) || !classify(e.fileName)) return zf.readEntry();
        const target = path.resolve(dest, e.fileName);
        if (!target.startsWith(dest + path.sep)) return zf.readEntry();
        fs.mkdirSync(path.dirname(target), { recursive: true });
        zf.openReadStream(e, (err2, rs) => {
          if (err2) return reject(err2);
          const ws = fs.createWriteStream(target);
          rs.pipe(ws);
          ws.on('finish', () => zf.readEntry());
          ws.on('error', reject);
        });
      });
      zf.readEntry();
    });
  });
}

/* ---------- Album partagé iCloud ---------- */
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const b62 = (s) => [...s].reduce((n, c) => n * 62 + B62.indexOf(c), 0);

function icloudToken(input) {
  let t = String(input).trim();
  const m = t.match(/#([A-Za-z0-9]+)/) || t.match(/sharedalbum\/([A-Za-z0-9]+)/);
  if (m) t = m[1];
  return /^[A-Za-z0-9]{8,}$/.test(t) ? t : null;
}
async function icloudPost(host, token, endpoint, body) {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`https://${host}/${token}/sharedstreams/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (res.status === 330) { host = (await res.json())['X-Apple-MMe-Host']; continue; }
    if (!res.ok) throw new Error('iCloud a répondu avec le code ' + res.status + '. Le lien est-il bien un album partagé public ?');
    return { json: await res.json(), host };
  }
  throw new Error('iCloud : trop de redirections.');
}
async function importIcloud(link) {
  const token = icloudToken(link);
  if (!token) throw new Error('Lien non reconnu. Collez le lien complet de l’album partagé (il contient « #… »).');
  const part = token[0] === 'A' ? b62(token[1]) : b62(token.slice(1, 3));
  const host0 = `p${String(part).padStart(2, '0')}-sharedstreams.icloud.com`;
  const { json: stream, host } = await icloudPost(host0, token, 'webstream', { streamCtag: null });

  const byChecksum = new Map();
  for (const ph of stream.photos || []) {
    if (ph.mediaAssetType === 'video') continue;
    let best = null;
    for (const [k, d] of Object.entries(ph.derivatives || {})) {
      if (!/^\d+$/.test(k)) continue;
      if (!best || Number(d.width || k) > Number(best.width || best.k)) best = { ...d, k };
    }
    if (best && best.checksum) byChecksum.set(best.checksum, { guid: ph.photoGuid, size: Number(best.fileSize) || 0 });
  }
  const guids = [...new Set([...byChecksum.values()].map(v => v.guid))];
  const albumName = stream.streamName || 'Album iCloud';
  const out = [];
  for (let i = 0; i < guids.length; i += 25) {
    const { json } = await icloudPost(host, token, 'webasseturls', { photoGuids: guids.slice(i, i + 25) });
    for (const [checksum, it] of Object.entries(json.items || {})) {
      const meta = byChecksum.get(checksum);
      if (!meta) continue;
      out.push({ name: `Photo ${out.length + 1}`, dir: 'iCloud · ' + albumName, path: null,
                 url: `https://${it.url_location}${it.url_path}`, size: meta.size,
                 kind: 'image', needs: null, key: 'icloud-' + checksum.slice(0, 24) });
    }
  }
  return out;
}

/* ---------- Conversion de médias (ffmpeg embarqué, heic-convert) ---------- */
// ffmpeg : 1) variable FFMPEG_PATH, 2) ffmpeg-static (si installé), 3) « ffmpeg » du PATH système
let ffmpegPath = null;
try {
  ffmpegPath = process.env.FFMPEG_PATH || null;
  if (!ffmpegPath) {
    ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath) ffmpegPath = ffmpegPath.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  }
} catch {}
if (!ffmpegPath) ffmpegPath = 'ffmpeg';

function ff(args) {
  return new Promise((resolve, reject) => {
        execFile(ffmpegPath, args, { maxBuffer: 1 << 26, windowsHide: true }, (err, _o, stderr) =>
      err ? reject(new Error(err.code === 'ENOENT' ? 'ffmpeg est introuvable : installez-le (winget install ffmpeg) ou utilisez le bouton VLC.' : String(stderr || err.message).split('\n').filter(Boolean).slice(-2).join(' '))) : resolve());
  });
}

const inflight = new Map();
function prepare({ path: p, kind, force }) {
  const st = fs.statSync(p);
  const id = crypto.createHash('sha1').update(p + st.mtimeMs + st.size + (force ? 'f' : '')).digest('hex');
  if (inflight.has(id)) return inflight.get(id);
  const job = (async () => {
    fs.mkdirSync(mediaDir, { recursive: true });
    if (kind === 'image') {
      const out = path.join(mediaDir, id + '.jpg');
      if (!fs.existsSync(out)) {
        if (/\.(heic|heif)$/i.test(p)) {
          const convert = require('heic-convert');
          const jpg = await convert({ buffer: await fsp.readFile(p), format: 'JPEG', quality: 0.92 });
          await fsp.writeFile(out, Buffer.from(jpg));
        } else {
          await ff(['-y', '-i', p, '-frames:v', '1', '-q:v', '2', out]);
        }
      }
      return pathToFileURL(out).href;
    }
    const out = path.join(mediaDir, id + '.mp4');
    if (!fs.existsSync(out)) {
      const part = out + '.part';
      const base = ['-y', '-i', p, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn'];
      const tail = ['-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-f', 'mp4', part];
      const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
                   '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'];
      if (!force) {
        try { await ff([...base, '-c:v', 'copy', ...tail]); }          // rapide : simple changement de conteneur
        catch { await fsp.rm(part, { force: true }); await ff([...base, ...enc, ...tail]); }
      } else {
        await ff([...base, ...enc, ...tail]);                           // ré-encodage complet
      }
      await fsp.rename(part, out);
    }
    return pathToFileURL(out).href;
  })().finally(() => inflight.delete(id));
  inflight.set(id, job);
  return job;
}

/* ---------- VLC (recours ultime) ---------- */
function findVlc() {
  const c = process.platform === 'win32'
    ? ['C:\\Program Files\\VideoLAN\\VLC\\vlc.exe', 'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe']
    : process.platform === 'darwin'
      ? ['/Applications/VLC.app/Contents/MacOS/VLC']
      : ['/usr/bin/vlc', '/usr/local/bin/vlc', '/snap/bin/vlc', '/var/lib/flatpak/exports/bin/org.videolan.VLC'];
  return c.find(x => fs.existsSync(x)) || null;
}

/* ---------- Fenêtre & IPC ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 700, minHeight: 440,
    backgroundColor: '#141816', title: 'Image aléatoire',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  Menu.setApplicationMenu(null);
  win.loadFile('index.html');
}

const safe = (fn) => async (...a) => {
  try { return { ok: true, list: await fn(...a) }; }
  catch (e) { return { ok: false, error: e.message || String(e) }; }
};

ipcMain.handle('pick-folder', safe(async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : scanMany([r.filePaths[0]]);
}));
ipcMain.handle('scan-paths', safe((_e, paths) => scanMany(paths)));
ipcMain.handle('import-zip', safe(async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'], filters: [{ name: 'Archives ZIP', extensions: ['zip'] }]
  });
  if (r.canceled) return null;
  const dest = path.join(tmpRoot, 'zip-' + Date.now());
  fs.mkdirSync(dest, { recursive: true });
  for (const z of r.filePaths) await extractZip(z, dest);
  return scanMany([dest]);
}));
ipcMain.handle('import-icloud', safe((_e, link) => importIcloud(link)));
ipcMain.handle('prepare-media', async (_e, opts) => {
  try { return { ok: true, url: await prepare(opts) }; }
  catch (e) { return { ok: false, error: e.message || String(e) }; }
});
ipcMain.handle('open-vlc', (_e, p) => {
  const vlc = findVlc();
  if (!vlc) return { ok: false, error: 'VLC est introuvable. Installez-le depuis videolan.org.' };
  if (!p || !fs.existsSync(p)) return { ok: false, error: 'Fichier introuvable.' };
  spawn(vlc, [p, '--play-and-exit'], { detached: true, stdio: 'ignore' }).unref();
  return { ok: true };
});
ipcMain.handle('toggle-fullscreen', () => { win.setFullScreen(!win.isFullScreen()); return win.isFullScreen(); });
ipcMain.handle('exit-fullscreen', () => { win.setFullScreen(false); });
ipcMain.handle('open-external', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('quit', () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });
