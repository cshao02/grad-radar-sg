// Runs every source, enriches, and merges with the previous snapshot so we know
// what is NEW (firstSeen) and what has CLOSED (disappeared from a source that responded).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrich } from './enrich.mjs';
import { fetchMcf, COMPANY_SOURCES, companyFetch, pool } from './sources.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

const CLOSED_KEEP_DAYS = 14;

export function readJobs() {
  try { return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8')); } catch { return { meta: { updatedAt: null, sources: [] }, jobs: [] }; }
}

export function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export async function refreshAll(log = () => {}, { keepIds = new Set() } = {}) {
  const prevSnap = readJobs();
  const prev = new Map(prevSnap.jobs.map((j) => [j.id, j]));
  const now = new Date().toISOString();
  const statuses = [];
  const fetched = [];

  const tasks = [
    { name: 'MyCareersFuture', run: () => fetchMcf(prev) },
    ...COMPANY_SOURCES.map((s) => ({ name: s[2], run: companyFetch(s) })),
  ];

  await pool(tasks, 5, async (t) => {
    const t0 = Date.now();
    try {
      const jobs = await t.run();
      statuses.push({ name: t.name, ok: true, count: jobs.length, ms: Date.now() - t0 });
      fetched.push({ name: t.name, jobs });
      log(`ok   ${t.name}: ${jobs.length} candidate postings`);
    } catch (e) {
      statuses.push({ name: t.name, ok: false, error: String(e.message || e), ms: Date.now() - t0 });
      log(`FAIL ${t.name}: ${e.message || e}`);
    }
  });

  const okSources = new Set(statuses.filter((s) => s.ok).map((s) => s.name));
  const nameOfJob = (j) => (j.source === 'MyCareersFuture' ? 'MyCareersFuture' : j.company);
  const merged = new Map();
  const isFirstRun = prev.size === 0;

  for (const { jobs } of fetched) {
    for (const raw of jobs) {
      const e = enrich(raw);
      const old = prev.get(e.id);
      e.firstSeen = old?.firstSeen ?? now;
      e.lastSeen = now;
      e.closedAt = null;
      e.isNew = !isFirstRun && !old;
      merged.set(e.id, e);
    }
  }

  // jobs we knew about that are gone
  for (const [id, old] of prev) {
    if (merged.has(id)) continue;
    const src = nameOfJob(old);
    if (okSources.has(src)) {
      const closedAt = old.closedAt ?? now;
      if ((Date.now() - new Date(closedAt).getTime()) / 86400000 <= CLOSED_KEEP_DAYS) merged.set(id, { ...old, closedAt, isNew: false });
    } else {
      merged.set(id, old); // source failed this time: keep as-is rather than wrongly closing it
    }
  }

  // expired on MCF => treat as closed
  const today = now.slice(0, 10);
  for (const j of merged.values()) if (!j.closedAt && j.expiresAt && j.expiresAt < today) j.closedAt = now;

  // collapse reposts: same company + same normalised title. Keep the newest, remember the others.
  const norm = (s) => s.toLowerCase().replace(/#\s*\w+|\(.*?\)|\[.*?\]|[^a-z0-9+#]+/g, ' ').replace(/\s+/g, ' ').trim();
  const groups = new Map();
  for (const j of merged.values()) {
    if (j.closedAt) continue;
    const key = `${j.company.toLowerCase()}|${norm(j.title)}`;
    (groups.get(key) || groups.set(key, []).get(key)).push(j);
  }
  for (const g of groups.values()) {
    if (g.length < 2) { g[0].reposts = 0; continue; }
    g.sort((a, b) => (keepIds.has(b.id) - keepIds.has(a.id)) || String(b.postedAt).localeCompare(String(a.postedAt)));
    g[0].reposts = g.length - 1;
    g[0].applicants = g.reduce((s, x) => s + (x.applicants || 0), 0) || g[0].applicants;
    if (g.some((x) => x.views != null)) g[0].views = g.reduce((s, x) => s + (x.views || 0), 0);
    for (const d of g.slice(1)) merged.delete(d.id);
  }

  const out = {
    meta: { updatedAt: now, previousUpdatedAt: prevSnap.meta.updatedAt, firstRun: isFirstRun, sources: statuses.sort((a, b) => a.name.localeCompare(b.name)) },
    jobs: [...merged.values()],
  };
  writeAtomic(JOBS_FILE, JSON.stringify(out));
  const open = out.jobs.filter((j) => !j.closedAt);
  log(`saved ${out.jobs.length} jobs (${open.length} open, ${open.filter((j) => j.isNew).length} new)`);
  return out;
}
