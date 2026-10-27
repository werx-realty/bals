import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// ---------- storage (Vercel Blob in production, local folder when LOCAL_STORE is set) ----------
const LOCAL = process.env.LOCAL_STORE;
let blob;
async function B() { if (!blob) blob = await import('@vercel/blob'); return blob; }

export async function putFile(pathname, body, contentType, random = true) {
  if (LOCAL) {
    const name = random ? pathname.replace(/(\.[\w]+)?$/, m => '-' + crypto.randomBytes(6).toString('hex') + m) : pathname;
    const fp = path.join(LOCAL, name);
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, body);
    return { url: '/__store/' + name, pathname: name };
  }
  const { put } = await B();
  const r = await put(pathname, body, { access: 'public', contentType, addRandomSuffix: random, allowOverwrite: !random });
  return { url: r.url, pathname: r.pathname };
}

export async function listFiles(prefix) {
  if (LOCAL) {
    const dir = path.join(LOCAL, prefix);
    const out = [];
    async function walk(d) {
      let ents = [];
      try { ents = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const fp = path.join(d, e.name);
        if (e.isDirectory()) await walk(fp);
        else { const rel = path.relative(LOCAL, fp); out.push({ pathname: rel, url: '/__store/' + rel, size: (await fs.stat(fp)).size }); }
      }
    }
    await walk(dir);
    return out;
  }
  const { list } = await B();
  let cursor, out = [];
  do { const r = await list({ prefix, cursor, limit: 1000 }); out = out.concat(r.blobs); cursor = r.cursor; } while (cursor);
  return out;
}

export async function readJSON(file) {
  if (LOCAL) return JSON.parse(await fs.readFile(path.join(LOCAL, file.pathname), 'utf8'));
  const r = await fetch(file.url, { cache: 'no-store' });
  if (!r.ok) throw new Error('read failed');
  return r.json();
}

export async function delFiles(urls) {
  if (!urls.length) return;
  if (LOCAL) { for (const u of urls) await fs.rm(path.join(LOCAL, u.replace('/__store/', '')), { force: true }); return; }
  const { del } = await B();
  await del(urls);
}

// ---------- content ----------
export async function versions() {
  const files = await listFiles('content/');
  return files.filter(f => f.pathname.endsWith('.json')).sort((a, b) => b.pathname.localeCompare(a.pathname));
}
export async function latestContent() {
  const v = await versions();
  if (!v.length) return {};
  try { return await readJSON(v[0]); } catch { return {}; }
}

// ---------- auth ----------
const secret = () => (process.env.SESSION_SECRET || 'dev') + '|' + (process.env.ADMIN_PASSWORD || '');
export const sign = exp => exp + '.' + crypto.createHmac('sha256', secret()).update(String(exp)).digest('hex');
export function authed(req) {
  const t = String(req.headers['x-auth'] || '');
  const exp = t.split('.')[0];
  if (!exp || !(+exp > Date.now())) return false;
  const good = sign(exp);
  return t.length === good.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(good));
}
export function checkPassword(p) {
  const a = Buffer.from(String(p || '')), b = Buffer.from(String(process.env.ADMIN_PASSWORD || ''));
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- validation: only safe, limited changes are ever stored ----------
const HEX = /^#[0-9a-f]{6}$/i;
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
export function cleanHTML(h) {
  return str(h, 3000)
    .replace(/<(?!\/?(em|b|strong|br)\s*\/?>)[^>]*>/gi, '')   // only em/b/strong/br, no attributes
    .replace(/&(?!(amp|lt|gt|quot|#39|nbsp|#\d+);)/g, '&amp;');
}
const okUrl = u => typeof u === 'string' && u.length < 600 && /^(https?:\/\/|\/__store\/|data:image\/(jpeg|png|webp);base64,)/.test(u) && !/^data:/.test(u.slice(0, 0));
const okHref = u => typeof u === 'string' && u.length < 600 && /^(https?:\/\/|mailto:|tel:|#)/.test(u);
const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
const TYPES = new Set(['nos', 'half', 'ev', 'closed']);

export function validate(c) {
  const out = { text: {}, img: {}, href: {}, theme: {}, cal: {}, settings: {} };
  for (const [k, v] of Object.entries(c.text || {})) if (/^[\w.-]{1,40}$/.test(k)) out.text[k] = cleanHTML(v);
  for (const [k, v] of Object.entries(c.img || {})) if (/^[\w.-]{1,40}$/.test(k) && v && okUrl(v.url) && !String(v.url).startsWith('data:')) out.img[k] = { url: v.url, fit: v.fit === 'contain' ? 'contain' : 'cover' };
  for (const [k, v] of Object.entries(c.href || {})) if (/^[\w.-]{1,40}$/.test(k) && okHref(v)) out.href[k] = v;
  const t = c.theme || {};
  // main + accent colors must stay dark enough for white text; backgrounds must stay light
  for (const k of ['navy', 'bark']) if (HEX.test(t[k] || '') && lum(t[k]) < 0.18) out.theme[k] = t[k];
  for (const k of ['cream', 'paper']) if (HEX.test(t[k] || '') && lum(t[k]) > 0.75) out.theme[k] = t[k];
  if (HEX.test(t.sun || '') && lum(t.sun) > 0.3) out.theme.sun = t.sun;
  if (t.scale) out.theme.scale = Math.min(1.15, Math.max(0.9, Math.round(+t.scale * 100) / 100 || 1));
  for (const [id, months] of Object.entries(c.cal || {})) {
    if (!/^[\w-]{1,20}$/.test(id) || !Array.isArray(months)) continue;
    out.cal[id] = months.slice(0, 14).map(m => {
      const [y, mo, evs] = m || [];
      const dim = new Date(+y, +mo + 1, 0).getDate();
      return [Math.min(2100, Math.max(2020, +y | 0)), Math.min(11, Math.max(0, +mo | 0)),
        (Array.isArray(evs) ? evs : []).slice(0, 40).map(e => {
          let d = e[0];
          if (typeof d === 'string' && /^\d{1,2}-\d{1,2}$/.test(d)) { let [a, b] = d.split('-').map(Number); a = Math.min(dim, Math.max(1, a)); b = Math.min(dim, Math.max(a, b)); d = a === b ? a : a + '-' + b; }
          else d = Math.min(dim, Math.max(1, +d | 0));
          return [d, TYPES.has(e[1]) ? e[1] : 'ev', str(e[2], 80), str(e[3], 140)];
        }).filter(e => e[2])];
    });
  }
  const s = c.settings || {};
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email || '')) out.settings.email = s.email.slice(0, 120);
  return out;
}

export function send(res, code, obj) { res.status(code).setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); }
