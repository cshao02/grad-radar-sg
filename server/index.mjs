// Grad Radar SG local server: JSON API + static UI + auto-refresh every few hours.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refreshAll, readJobs, writeAtomic, DATA_DIR } from './refresh.mjs';
import { MANUAL_SOURCES, COMPANY_SOURCES } from './sources.mjs';
import { TECH_NAMES, ROLE_LABEL } from './enrich.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4317);
// HOSTED=1 is for a public deployment: listen on all interfaces, keep no per-user data on the server
// (tracker/profile live in each visitor's browser) and rate-limit manual refreshes.
const HOSTED = process.env.HOSTED === '1';
const HOST = process.env.HOST || (HOSTED ? '0.0.0.0' : '127.0.0.1');
const MANUAL_COOLDOWN_MS = 10 * 60 * 1000;
const REFRESH_HOURS = Number(process.env.REFRESH_HOURS || 6);
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const DIST = path.join(__dirname, '..', 'dist');

const DEFAULT_STORE = { tracker: {}, profile: null, state: { lastSeenAt: null } };
function readStore() {
  if (HOSTED) return structuredClone(DEFAULT_STORE);
  try { return { ...DEFAULT_STORE, ...JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) }; } catch { return structuredClone(DEFAULT_STORE); }
}
function saveStore(s) { if (!HOSTED) writeAtomic(STORE_FILE, JSON.stringify(s, null, 2)); }

let refreshing = null;
let lastError = null;
let lastRefreshAt = 0;
function runRefresh(reason) {
  if (refreshing) return refreshing;
  const t0 = Date.now();
  console.log(`[refresh] start (${reason})`);
  refreshing = refreshAll((m) => console.log(`[refresh] ${m}`), { keepIds: new Set(Object.keys(readStore().tracker)) })
    .then((snap) => {
      lastError = null;
      lastRefreshAt = Date.now();
      const st = readStore();
      if (!st.state.lastSeenAt) { st.state.lastSeenAt = snap.meta.updatedAt; saveStore(st); }
      console.log(`[refresh] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return snap;
    })
    .catch((e) => { lastError = String(e.message || e); console.error('[refresh] failed', e); throw e; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const readBody = (req) => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 1e6) reject(new Error('too large')); });
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
});

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function serveStatic(req, res) {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(DIST, u === '/' ? 'index.html' : u);
  if (!file.startsWith(DIST)) return send(res, 403, 'forbidden', 'text/plain');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) return send(res, 404, 'UI not built yet. Run `npm run build`, or use `npm run dev:ui` during development.', 'text/plain');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (!p.startsWith('/api/')) return serveStatic(req, res);

    if (p === '/api/jobs' && req.method === 'GET') {
      const snap = readJobs();
      return send(res, 200, {
        ...snap,
        meta: { ...snap.meta, refreshing: Boolean(refreshing), lastError, refreshHours: REFRESH_HOURS, techCatalog: TECH_NAMES, roleLabels: ROLE_LABEL },
      });
    }
    if (p === '/api/refresh' && req.method === 'POST') {
      if (HOSTED && !refreshing && Date.now() - lastRefreshAt < MANUAL_COOLDOWN_MS) {
        return send(res, 200, { ok: true, cached: true, updatedAt: readJobs().meta.updatedAt }); // refreshed recently, serve what we have
      }
      const snap = await runRefresh('manual');
      return send(res, 200, { ok: true, updatedAt: snap.meta.updatedAt });
    }
    if (p === '/api/store' && req.method === 'GET') return send(res, 200, { ...readStore(), hosted: HOSTED });
    if (HOSTED && (p === '/api/profile' || p === '/api/seen' || p.startsWith('/api/tracker'))) return send(res, 405, { error: 'stored in your browser in hosted mode' });
    if (p.startsWith('/api/tracker/') && req.method === 'PUT') {
      const id = decodeURIComponent(p.slice('/api/tracker/'.length));
      const body = await readBody(req);
      const st = readStore();
      if (!body.status) delete st.tracker[id];
      else st.tracker[id] = { ...(st.tracker[id] || {}), ...body, updatedAt: new Date().toISOString(), history: [...(st.tracker[id]?.history || []), ...(body.status !== st.tracker[id]?.status ? [{ status: body.status, at: new Date().toISOString() }] : [])] };
      saveStore(st);
      return send(res, 200, st.tracker[id] || null);
    }
    if (p === '/api/tracker' && req.method === 'POST') {
      // bulk: { ids: [...], status, snapshot: {id: {...minimal job}} }
      const body = await readBody(req);
      const st = readStore();
      const at = new Date().toISOString();
      for (const id of body.ids || []) {
        if (!body.status) { delete st.tracker[id]; continue; }
        const prev = st.tracker[id] || {};
        st.tracker[id] = { ...prev, status: body.status, job: body.snapshot?.[id] || prev.job, updatedAt: at, history: [...(prev.history || []), ...(prev.status !== body.status ? [{ status: body.status, at }] : [])] };
      }
      saveStore(st);
      return send(res, 200, st.tracker);
    }
    if (p === '/api/profile' && req.method === 'PUT') {
      const st = readStore();
      st.profile = await readBody(req);
      saveStore(st);
      return send(res, 200, st.profile);
    }
    if (p === '/api/seen' && req.method === 'POST') {
      const st = readStore();
      st.state.lastSeenAt = new Date().toISOString();
      saveStore(st);
      return send(res, 200, st.state);
    }
    if (p === '/api/sources' && req.method === 'GET') {
      return send(res, 200, { manual: MANUAL_SOURCES, boards: COMPANY_SOURCES.map(([kind, slug, name]) => ({ kind, slug, name })) });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Grad Radar SG running at http://${HOST}:${PORT}  (auto-refresh every ${REFRESH_HOURS}h)`);
  const snap = readJobs();
  const ageH = snap.meta.updatedAt ? (Date.now() - new Date(snap.meta.updatedAt).getTime()) / 3600000 : Infinity;
  if (ageH > 1) runRefresh(snap.meta.updatedAt ? `data is ${ageH.toFixed(1)}h old` : 'first run').catch(() => {});
  setInterval(() => runRefresh('scheduled').catch(() => {}), REFRESH_HOURS * 3600000);
});
