import { putFile, listFiles, readJSON, delFiles, versions, latestContent, validate, sign, authed, checkPassword, send } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const action = b.action;
  try {
    if (action === 'login') {
      if (!checkPassword(b.password)) { await new Promise(r => setTimeout(r, 800)); return send(res, 401, { error: 'Wrong password' }); }
      return send(res, 200, { token: sign(Date.now() + 1000 * 60 * 60 * 24 * 14) });
    }
    if (!authed(req)) return send(res, 401, { error: 'Please log in again' });

    switch (action) {
      case 'load':
        return send(res, 200, { content: await latestContent() });

      case 'save': {
        const clean = validate(b.content || {});
        const name = `content/${Date.now()}.json`;
        await putFile(name, JSON.stringify(clean), 'application/json', false);
        const v = await versions();
        if (v.length > 40) await delFiles(v.slice(40).map(f => f.url));
        return send(res, 200, { ok: true, content: clean });
      }

      case 'history': {
        const v = await versions();
        return send(res, 200, { items: v.slice(0, 25).map(f => ({ id: f.pathname, at: +f.pathname.replace(/\D/g, '') })) });
      }

      case 'restore': {
        const v = await versions();
        const f = v.find(x => x.pathname === b.id);
        if (!f) return send(res, 404, { error: 'Version not found' });
        const c = validate(await readJSON(f));
        await putFile(`content/${Date.now()}.json`, JSON.stringify(c), 'application/json', false);
        return send(res, 200, { ok: true, content: c });
      }

      case 'upload': {
        const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(String(b.data || ''));
        if (!m) return send(res, 400, { error: 'Please choose a JPG or PNG photo' });
        const buf = Buffer.from(m[3], 'base64');
        if (buf.length > 4e6) return send(res, 400, { error: 'Photo is too large' });
        const up = await putFile(`images/photo.${m[2] === 'jpeg' ? 'jpg' : m[2]}`, buf, m[1]);
        return send(res, 200, { url: up.url });
      }

      case 'inbox': {
        const files = (await listFiles('submissions/')).sort((a, c) => c.pathname.localeCompare(a.pathname)).slice(0, 150);
        const read = new Set((await listFiles('meta/read/')).map(f => f.pathname.split('/').pop().replace(/\.txt$/, '')));
        const items = await Promise.all(files.map(async f => {
          try { const r = await readJSON(f); return { id: f.pathname, url: f.url, ...r, read: read.has(key(f.pathname)) }; } catch { return null; }
        }));
        return send(res, 200, { items: items.filter(Boolean) });
      }

      case 'markRead': {
        await putFile(`meta/read/${key(b.id)}.txt`, '1', 'text/plain', false);
        return send(res, 200, { ok: true });
      }

      case 'delete': {
        const files = await listFiles('submissions/');
        const f = files.find(x => x.pathname === b.id);
        if (!f) return send(res, 404, { error: 'Not found' });
        const rec = await readJSON(f).catch(() => ({}));
        await delFiles([f.url, ...(rec.files || []).map(x => x.url)]);
        return send(res, 200, { ok: true });
      }
    }
    send(res, 400, { error: 'Unknown action' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Something went wrong — please try again' });
  }
}

const key = p => String(p).split('/').pop().replace(/\.json$/, '').replace(/[^\w-]/g, '').slice(0, 120);
