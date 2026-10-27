import { putFile, send } from './_lib.js';

const OK_TYPES = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif)|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/octet-stream)$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const type = b.type === 'forms' ? 'forms' : 'enrollment';
    const data = {};
    for (const [k, v] of Object.entries(b.data || {}).slice(0, 40)) {
      if (k === 'website') { if (v) return send(res, 200, { ok: true }); continue; } // spam trap
      data[String(k).slice(0, 60)] = String(v ?? '').slice(0, 2000);
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const files = [];
    for (const f of (Array.isArray(b.files) ? b.files : []).slice(0, 5)) {
      const m = /^data:([^;]+);base64,(.+)$/.exec(String(f.data || ''));
      if (!m || !OK_TYPES.test(m[1])) continue;
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 4.5e6) continue;
      const name = String(f.name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 80);
      const up = await putFile(`uploads/${ts}/${name}`, buf, m[1]);
      files.push({ name, url: up.url, size: buf.length, type: m[1] });
    }
    if (type === 'forms' && !files.length) return send(res, 400, { error: 'No valid files' });
    const rec = { type, at: new Date().toISOString(), data, files };
    await putFile(`submissions/${ts}-${type}.json`, JSON.stringify(rec), 'application/json');
    send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Could not save' });
  }
}
