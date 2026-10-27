import { latestContent } from './_lib.js';

export default async function handler(req, res) {
  let c = {};
  try { c = await latestContent(); } catch (e) { console.error(e); }
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=300');
  res.end('window.__C=' + JSON.stringify(c).replace(/</g, '\\u003c') + ';');
}
