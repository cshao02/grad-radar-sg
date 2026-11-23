// Shared types, the match-scoring engine, formatting and API helpers.

export type Role = 'fullstack' | 'backend' | 'frontend' | 'ai' | 'software' | 'ml' | 'mobile' | 'data' | 'devops' | 'qa' | 'security' | 'embedded' | 'other';
export type Tier = 'fresh' | 'junior' | 'unknown' | 'senior';
export type Status = 'saved' | 'applied' | 'oa' | 'interview' | 'offer' | 'rejected' | 'ignored';

export interface Job {
  id: string;
  source: string;
  company: string;
  postedBy?: string;
  title: string;
  location: string;
  url: string;
  applyUrl?: string;
  postedAt: string | null;
  expiresAt: string | null;
  salary: { min: number; max: number; period: string; currency: string } | null;
  desc: string;
  sourceLevel: string | null;
  employmentTypes: string[];
  applicants: number | null;
  views?: number | null;
  role: Role;
  techs: string[];
  years: number | null;
  tier: Tier;
  flags: { agency: boolean; intern: boolean; senior: boolean; explicitGrad: boolean; gradTitle?: boolean; diploma?: boolean; needsChinese: boolean };
  firstSeen: string;
  lastSeen: string;
  closedAt: string | null;
  reposts?: number;
}

export interface SourceStatus { name: string; ok: boolean; count?: number; error?: string; ms: number }
export interface Meta {
  updatedAt: string | null;
  previousUpdatedAt: string | null;
  sources: SourceStatus[];
  refreshing: boolean;
  lastError: string | null;
  refreshHours: number;
  techCatalog: string[];
  roleLabels: Record<Role, string>;
}

export interface TrackerEntry {
  status: Status;
  note?: string;
  job?: Pick<Job, 'title' | 'company' | 'url' | 'role'>;
  updatedAt: string;
  history?: { status: Status; at: string }[];
}

export interface Profile {
  strong: string[];
  familiar: string[];
  rolePrefs: Record<Role, number>;
  penalizeAgency: boolean;
}

export interface Store {
  tracker: Record<string, TrackerEntry>;
  profile: Profile | null;
  state: { lastSeenAt: string | null };
}

// ---------------- defaults from Shaoheng's resume ----------------
export const DEFAULT_PROFILE: Profile = {
  strong: ['Go', 'TypeScript', 'JavaScript', 'React', 'Next.js', 'SQL', 'MySQL', 'Python', 'gRPC', 'Microservices', 'REST', 'Tailwind', 'HTML/CSS', 'Firebase'],
  familiar: ['Java', 'Hive/Spark', 'MongoDB', 'C++', 'Swift', 'Node.js', 'LLM', 'AI Agents', 'Prompt Eng.', 'OpenAI/Claude APIs'],
  rolePrefs: { fullstack: 1, backend: 0.85, ai: 0.75, software: 0.7, frontend: 0.65, mobile: 0.3, devops: 0.25, data: 0.2, security: 0.1, qa: 0.1, embedded: 0.05, ml: 0, other: 0 },
  penalizeAgency: true,
};

export const ROLE_ORDER: Role[] = ['fullstack', 'backend', 'frontend', 'ai', 'software', 'mobile', 'devops', 'data', 'security', 'qa', 'embedded', 'ml', 'other'];
export const DEFAULT_ROLES: Role[] = ['fullstack', 'backend', 'frontend', 'ai', 'software'];

export const STATUSES: { id: Status; label: string; tone: string }[] = [
  { id: 'saved', label: 'Saved', tone: 'slate' },
  { id: 'applied', label: 'Applied', tone: 'blue' },
  { id: 'oa', label: 'OA', tone: 'violet' },
  { id: 'interview', label: 'Interview', tone: 'amber' },
  { id: 'offer', label: 'Offer', tone: 'green' },
  { id: 'rejected', label: 'Rejected', tone: 'red' },
  { id: 'ignored', label: 'Not for me', tone: 'muted' },
];
export const statusLabel = (s: Status) => STATUSES.find((x) => x.id === s)?.label ?? s;

export const TIER_LABEL: Record<Tier, string> = { fresh: 'Fresh grad', junior: '≤2 yrs', unknown: 'Exp. not stated', senior: 'Senior' };

// ---------------- scoring ----------------
const GENERIC = new Set(['REST', 'Prompt Eng.', 'HTML/CSS', 'Linux', 'CI/CD', 'SQL', 'Microservices']);

export interface Score {
  total: number;
  parts: { role: number; skills: number; level: number; timing: number; penalty: number };
  matched: string[];
  partial: string[];
  missing: string[];
  reasons: string[];
}

export function daysSince(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

export function scoreJob(job: Job, p: Profile): Score {
  const reasons: string[] = [];
  const pref = p.rolePrefs[job.role] ?? 0;
  const role = Math.round(40 * pref);

  const strong = new Set(p.strong), familiar = new Set(p.familiar);
  const matched: string[] = [], partial: string[] = [], missing: string[] = [];
  let tot = 0, got = 0;
  for (const t of job.techs) {
    const w = GENERIC.has(t) ? 0.5 : 1;
    tot += w;
    if (strong.has(t)) { got += w; matched.push(t); }
    else if (familiar.has(t)) { got += w * 0.6; partial.push(t); }
    else missing.push(t);
  }
  // little evidence => pull towards neutral
  const ratio = tot >= 3 ? got / tot : (got + 0.5 * (3 - tot)) / 3;
  const skills = Math.round(35 * Math.min(1, ratio));

  const level = job.tier === 'fresh' ? (job.flags.gradTitle ? 15 : job.flags.explicitGrad ? 13 : 10) : job.tier === 'junior' ? 7 : job.tier === 'unknown' ? 5 : 0;

  const age = daysSince(job.postedAt);
  const fresh = age === null ? 2 : age <= 7 ? 5 : age <= 21 ? 3 : 1;
  // MCF's public API hides applicant counts, so views are a rough proxy (~1 in 8 viewers applies)
  const crowd = job.applicants ?? (job.views != null ? job.views / 8 : null);
  const comp = crowd === null ? 3 : crowd < 15 ? 5 : crowd < 50 ? 3 : 1;
  const timing = fresh + comp;

  const penalty = (p.penalizeAgency && job.flags.agency ? -6 : 0) + (job.flags.diploma ? -12 : 0);
  const total = Math.max(0, Math.min(100, role + skills + level + timing + penalty));

  if (pref >= 0.85) reasons.push(`${roleName(job.role)} is a top preference`);
  else if (pref <= 0.3) reasons.push(`${roleName(job.role)} is low on your list`);
  if (matched.length) reasons.push(`Uses your ${matched.slice(0, 4).join(', ')}`);
  if (missing.filter((m) => !GENERIC.has(m)).length >= 3) reasons.push(`Asks for ${missing.filter((m) => !GENERIC.has(m)).slice(0, 3).join(', ')}`);
  if (job.flags.explicitGrad) reasons.push('Explicitly open to fresh grads');
  else if (job.years !== null) reasons.push(job.years === 0 ? 'No experience required' : `Asks for ${job.years}+ yrs`);
  if (job.applicants !== null && job.applicants < 15) reasons.push(`Only ${job.applicants} applicants so far`);
  else if (job.applicants === null && job.views != null && job.views < 120) reasons.push(`Low competition: only ${job.views} views`);
  if (job.flags.agency) reasons.push('Posted by a recruitment agency');
  if (job.flags.diploma) reasons.push('Aimed at diploma / polytechnic holders, not degree graduates');
  return { total, parts: { role, skills, level, timing, penalty }, matched, partial, missing, reasons };
}

const ROLE_NAMES: Record<Role, string> = {
  fullstack: 'Full-stack', backend: 'Backend', frontend: 'Frontend', ai: 'AI / Agent', software: 'Software (general)', ml: 'ML / Research', mobile: 'Mobile',
  data: 'Data', devops: 'DevOps / SRE', qa: 'QA / Test', security: 'Security', embedded: 'Embedded / HW', other: 'Other',
};
export const roleName = (r: Role) => ROLE_NAMES[r] ?? r;

// ---------------- formatting ----------------
export function ago(d: string | null): string {
  const n = daysSince(d);
  if (n === null) return '—';
  if (n === 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 30) return `${n}d ago`;
  return `${Math.floor(n / 30)}mo ago`;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function money(s: Job['salary']): string | null {
  if (!s || !s.min) return null;
  const k = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : String(v));
  return s.max && s.max !== s.min ? `$${k(s.min)}–${k(s.max)}/mo` : `$${k(s.min)}/mo`;
}

export function daysLeft(d: string | null): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

// ---------------- API ----------------
async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

// In hosted (public) mode the server never stores anything about the visitor: the tracker, profile and
// "last seen" marker live in this browser's localStorage, so every visitor has a private copy.
const LS_STORE = 'gr.store.v1';
// STATIC builds (GitHub Pages) have no server at all: data comes from jobs.json, regenerated by a scheduled GitHub Action.
export const STATIC = import.meta.env.VITE_STATIC === '1';
let hosted = STATIC;
const readLocal = (): Store => {
  try { return { tracker: {}, profile: null, state: { lastSeenAt: null }, ...JSON.parse(localStorage.getItem(LS_STORE) || '{}') }; }
  catch { return { tracker: {}, profile: null, state: { lastSeenAt: null } }; }
};
const writeLocal = (s: Store) => localStorage.setItem(LS_STORE, JSON.stringify(s));
const withHistory = (prev: TrackerEntry | undefined, status: Status, at: string) => [...(prev?.history || []), ...(prev?.status !== status ? [{ status, at }] : [])];

export const api = {
  isHosted: () => hosted,
  jobs: async () => {
    if (!STATIC) return req<{ meta: Meta; jobs: Job[] }>('/api/jobs');
    const d = await req<{ meta: Meta; jobs: Job[] }>(`./jobs.json?t=${Date.now()}`);
    return { ...d, meta: { ...d.meta, refreshing: false, lastError: null } };
  },
  store: async (): Promise<Store> => {
    if (!STATIC) {
      const s = await req<Store & { hosted?: boolean }>('/api/store');
      hosted = Boolean(s.hosted);
      if (!hosted) return s;
    }
    const l = readLocal();
    if (!l.state.lastSeenAt) { l.state.lastSeenAt = new Date().toISOString(); writeLocal(l); } // first visit: nothing counts as "new" yet
    return l;
  },
  refresh: () => (STATIC ? Promise.resolve({ ok: true }) : req<{ ok: boolean }>('/api/refresh', { method: 'POST' })),
  setStatus: async (id: string, body: Partial<TrackerEntry> | { status: null }): Promise<TrackerEntry | null> => {
    if (!hosted) return req<TrackerEntry | null>(`/api/tracker/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });
    const s = readLocal(); const at = new Date().toISOString(); const prev = s.tracker[id];
    if (!body.status) delete s.tracker[id];
    else s.tracker[id] = { ...(prev || {}), ...body, status: body.status, updatedAt: at, history: withHistory(prev, body.status, at) } as TrackerEntry;
    writeLocal(s);
    return s.tracker[id] || null;
  },
  bulk: async (ids: string[], status: Status | null, snapshot: Record<string, TrackerEntry['job']>): Promise<Record<string, TrackerEntry>> => {
    if (!hosted) return req<Record<string, TrackerEntry>>('/api/tracker', { method: 'POST', body: JSON.stringify({ ids, status, snapshot }) });
    const s = readLocal(); const at = new Date().toISOString();
    for (const id of ids) {
      if (!status) { delete s.tracker[id]; continue; }
      const prev = s.tracker[id];
      s.tracker[id] = { ...(prev || {}), status, job: snapshot[id] || prev?.job, updatedAt: at, history: withHistory(prev, status, at) };
    }
    writeLocal(s);
    return s.tracker;
  },
  saveProfile: async (p: Profile): Promise<Profile> => {
    if (!hosted) return req<Profile>('/api/profile', { method: 'PUT', body: JSON.stringify(p) });
    const s = readLocal(); s.profile = p; writeLocal(s); return p;
  },
  seen: async (): Promise<{ lastSeenAt: string }> => {
    if (!hosted) return req<{ lastSeenAt: string }>('/api/seen', { method: 'POST' });
    const s = readLocal(); s.state.lastSeenAt = new Date().toISOString(); writeLocal(s); return { lastSeenAt: s.state.lastSeenAt };
  },
  sources: () => req<{ manual: { name: string; url: string; note: string }[]; boards: { kind: string; slug: string; name: string }[] }>(STATIC ? './sources.json' : '/api/sources'),
};

export const snap = (j: Job): TrackerEntry['job'] => ({ title: j.title, company: j.company, url: j.url, role: j.role });
