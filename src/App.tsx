import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api, ago, daysLeft, DEFAULT_PROFILE, DEFAULT_ROLES, money, roleName, ROLE_ORDER, scoreJob, snap, STATIC, STATUSES, statusLabel, TIER_LABEL, timeAgo,
  type Job, type Meta, type Profile, type Role, type Score, type Status, type Store, type Tier, type TrackerEntry,
} from './lib';

type View = 'feed' | 'tracker' | 'profile' | 'sources';
type Sort = 'match' | 'newest' | 'salary' | 'few';

interface Filters {
  q: string;
  roles: Role[];
  tiers: Tier[];
  hideAgency: boolean;
  showIntern: boolean;
  showClosed: boolean;
  onlyNew: boolean;
  hideTracked: boolean;
  source: 'all' | 'mcf' | 'company';
  sort: Sort;
}
const DEFAULT_FILTERS: Filters = {
  q: '', roles: DEFAULT_ROLES, tiers: ['fresh', 'junior', 'unknown'], hideAgency: true, showIntern: false, showClosed: false, onlyNew: false, hideTracked: false, source: 'all', sort: 'match',
};
function loadFilters(): Filters {
  try { return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem('gr.filters') || '{}') }; } catch { return DEFAULT_FILTERS; }
}

export default function App() {
  const [view, setView] = useState<View>('feed');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [store, setStore] = useState<Store>({ tracker: {}, profile: null, state: { lastSeenAt: null } });
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const profile = store.profile ?? DEFAULT_PROFILE;
  const say = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3200); }, []);

  const load = useCallback(async () => {
    try {
      const [j, s] = await Promise.all([api.jobs(), api.store()]);
      setJobs(j.jobs); setMeta(j.meta); setStore(s); setError(null);
      return j.meta;
    } catch (e) { setError(String((e as Error).message)); return null; } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { localStorage.setItem('gr.filters', JSON.stringify(filters)); }, [filters]);

  // poll while the server is refreshing on its own (startup or scheduled)
  useEffect(() => {
    if (!meta?.refreshing) return;
    const t = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(t);
  }, [meta?.refreshing, load]);
  // re-read data when the tab regains focus, so an open page never goes stale
  useEffect(() => {
    const h = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try { await api.refresh(); const m = await load(); say(`Updated. ${m?.sources.filter((s) => s.ok).length}/${m?.sources.length} sources responded.`); }
    catch (e) { say(`Refresh failed: ${(e as Error).message}`); } finally { setRefreshing(false); }
  };

  const lastSeen = store.state.lastSeenAt;
  const isNew = useCallback((j: Job) => !j.closedAt && !!lastSeen && j.firstSeen > lastSeen, [lastSeen]);

  const scored = useMemo(() => {
    const m = new Map<string, Score>();
    for (const j of jobs) m.set(j.id, scoreJob(j, profile));
    return m;
  }, [jobs, profile]);

  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const list = jobs.filter((j) => {
      if (!filters.roles.includes(j.role)) return false;
      if (!filters.tiers.includes(j.tier)) return false;
      if (filters.hideAgency && j.flags.agency) return false;
      if (!filters.showIntern && j.flags.intern) return false;
      if (!filters.showClosed && j.closedAt) return false;
      if (filters.onlyNew && !isNew(j)) return false;
      if (filters.hideTracked && store.tracker[j.id]) return false;
      if (store.tracker[j.id]?.status === 'ignored' && !filters.showClosed) return false;
      if (filters.source === 'mcf' && j.source !== 'MyCareersFuture') return false;
      if (filters.source === 'company' && j.source === 'MyCareersFuture') return false;
      if (q && !`${j.title} ${j.company} ${j.techs.join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const s = (j: Job) => scored.get(j.id)?.total ?? 0;
    const sal = (j: Job) => j.salary?.max ?? j.salary?.min ?? 0;
    list.sort((a, b) => {
      if (filters.sort === 'newest') return String(b.postedAt).localeCompare(String(a.postedAt)) || s(b) - s(a);
      if (filters.sort === 'salary') return sal(b) - sal(a) || s(b) - s(a);
      if (filters.sort === 'few') return (a.applicants ?? a.views ?? 99999) - (b.applicants ?? b.views ?? 99999) || s(b) - s(a);
      return s(b) - s(a);
    });
    return list;
  }, [jobs, filters, scored, store.tracker, isNew]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const j of jobs) {
      if (j.closedAt || !filters.tiers.includes(j.tier)) continue;
      if (filters.hideAgency && j.flags.agency) continue;
      if (!filters.showIntern && j.flags.intern) continue;
      c[j.role] = (c[j.role] || 0) + 1;
    }
    return c;
  }, [jobs, filters.tiers, filters.hideAgency, filters.showIntern]);

  const newCount = useMemo(() => jobs.filter(isNew).length, [jobs, isNew]);
  const trackedCount = Object.values(store.tracker).filter((t) => t.status !== 'ignored').length;
  const openJob = useMemo(() => jobs.find((j) => j.id === openId) ?? null, [jobs, openId]);

  // ---- tracker actions ----
  const setStatus = async (job: Job, status: Status | null) => {
    const entry = await api.setStatus(job.id, status ? { status, job: snap(job) } : { status: null });
    setStore((s) => { const t = { ...s.tracker }; if (entry) t[job.id] = entry; else delete t[job.id]; return { ...s, tracker: t }; });
  };
  const setNote = async (job: Job, note: string) => {
    const cur = store.tracker[job.id];
    const entry = await api.setStatus(job.id, { status: cur?.status ?? 'saved', note, job: snap(job) });
    setStore((s) => ({ ...s, tracker: { ...s.tracker, [job.id]: entry as TrackerEntry } }));
  };
  const bulk = async (status: Status | null) => {
    const ids = [...selected];
    const snapshot = Object.fromEntries(ids.map((id) => [id, snap(jobs.find((j) => j.id === id)!)]));
    const t = await api.bulk(ids, status, snapshot);
    setStore((s) => ({ ...s, tracker: t }));
    setSelected(new Set());
    say(status ? `${ids.length} marked ${statusLabel(status)}` : `${ids.length} removed from tracker`);
  };
  const openTabs = () => {
    const picks = visible.filter((j) => selected.has(j.id));
    if (picks.length > 12 && !window.confirm(`Open ${picks.length} tabs at once? Your browser may block some pop-ups.`)) return;
    picks.forEach((j) => window.open(j.applyUrl || j.url, '_blank', 'noopener'));
    say(`Opened ${picks.length} postings. If fewer tabs appeared, allow pop-ups for this site.`);
  };
  const markSeen = async () => { const s = await api.seen(); setStore((st) => ({ ...st, state: s })); };
  const saveProfile = async (p: Profile) => { await api.saveProfile(p); setStore((s) => ({ ...s, profile: p })); };

  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const allVisibleSelected = visible.length > 0 && visible.every((j) => selected.has(j.id));

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden><i /></span>
          <div>
            <h1>Grad Radar <span>SG</span></h1>
            <p>Fresh-grad software, full-stack and agent roles in Singapore</p>
          </div>
        </div>
        <nav className="tabs" aria-label="Views">
          {([['feed', 'Feed'], ['tracker', `Tracker${trackedCount ? ` · ${trackedCount}` : ''}`], ['profile', 'My profile'], ['sources', 'Sources']] as [View, string][]).map(([v, l]) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{l}</button>
          ))}
        </nav>
        <div className="sync">
          <div className="sync-text">
            <b>{meta?.refreshing || refreshing ? 'Updating…' : `Updated ${timeAgo(meta?.updatedAt ?? null)}`}</b>
            <small>{STATIC ? 'Job data refreshes automatically every 6h' : `Auto-refreshes every ${meta?.refreshHours ?? 6}h while running`}</small>
          </div>
          {STATIC
            ? <button className="btn primary" onClick={() => void load().then(() => say('Loaded the latest snapshot.'))}>Reload</button>
            : <button className="btn primary" onClick={refresh} disabled={refreshing || meta?.refreshing}>{refreshing || meta?.refreshing ? <span className="spin" /> : null}Refresh now</button>}
        </div>
      </header>

      {error && <div className="banner err">{STATIC ? `Could not load job data (${error}).` : <>Cannot reach the local server ({error}). Start it with <code>npm start</code>.</>}</div>}
      {api.isHosted() && view !== 'feed' && view !== 'sources' && <div className="banner info">Your tracker, notes and profile are saved only in this browser. Use Export CSV to keep a copy.</div>}
      {meta?.lastError && <div className="banner err">Last refresh failed: {meta.lastError}</div>}
      {meta && meta.sources.some((s) => !s.ok) && (
        <div className="banner warn">{meta.sources.filter((s) => !s.ok).length} source(s) failed in the last refresh ({meta.sources.filter((s) => !s.ok).map((s) => s.name).join(', ')}). Their previous results are kept.</div>
      )}

      {view === 'feed' && (
        <main className="feed">
          <section className="toolbar">
            <div className="row">
              <input className="search" placeholder="Search title, company or tech (e.g. react, go, grab)" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
              <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as Sort })} aria-label="Sort">
                <option value="match">Sort: best match</option>
                <option value="newest">Sort: newest</option>
                <option value="few">Sort: least crowded</option>
                <option value="salary">Sort: highest salary</option>
              </select>
              <select value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value as Filters['source'] })} aria-label="Source">
                <option value="all">All sources</option>
                <option value="mcf">MyCareersFuture only</option>
                <option value="company">Company career pages only</option>
              </select>
            </div>
            <div className="row chips">
              {ROLE_ORDER.filter((r) => r !== 'other').map((r) => (
                <button key={r} className={`chip ${filters.roles.includes(r) ? 'on' : ''}`} onClick={() => setFilters({ ...filters, roles: toggle(filters.roles, r) })}>
                  {roleName(r)} <em>{counts[r] ?? 0}</em>
                </button>
              ))}
            </div>
            <div className="row opts">
              <label><input type="checkbox" checked={filters.tiers.includes('fresh')} onChange={() => setFilters({ ...filters, tiers: toggle(filters.tiers, 'fresh') })} /> Fresh grad</label>
              <label><input type="checkbox" checked={filters.tiers.includes('junior')} onChange={() => setFilters({ ...filters, tiers: toggle(filters.tiers, 'junior') })} /> Up to 2 yrs</label>
              <label><input type="checkbox" checked={filters.tiers.includes('unknown')} onChange={() => setFilters({ ...filters, tiers: toggle(filters.tiers, 'unknown') })} /> Experience not stated</label>
              <label><input type="checkbox" checked={filters.tiers.includes('senior')} onChange={() => setFilters({ ...filters, tiers: toggle(filters.tiers, 'senior') })} /> Senior</label>
              <span className="sep" />
              <label><input type="checkbox" checked={filters.hideAgency} onChange={() => setFilters({ ...filters, hideAgency: !filters.hideAgency })} /> Hide agencies</label>
              <label><input type="checkbox" checked={filters.showIntern} onChange={() => setFilters({ ...filters, showIntern: !filters.showIntern })} /> Internships</label>
              <label><input type="checkbox" checked={filters.hideTracked} onChange={() => setFilters({ ...filters, hideTracked: !filters.hideTracked })} /> Hide ones I've tracked</label>
              <label><input type="checkbox" checked={filters.showClosed} onChange={() => setFilters({ ...filters, showClosed: !filters.showClosed })} /> Closed / ignored</label>
              <span className="sep" />
              <label className={newCount ? 'newlabel' : ''}><input type="checkbox" checked={filters.onlyNew} onChange={() => setFilters({ ...filters, onlyNew: !filters.onlyNew })} /> New since last visit ({newCount})</label>
              {newCount > 0 && <button className="link" onClick={markSeen}>Mark all seen</button>}
              <button className="link" onClick={() => setFilters(DEFAULT_FILTERS)}>Reset filters</button>
            </div>
          </section>

          <div className="listhead">
            <label className="all"><input type="checkbox" checked={allVisibleSelected} onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((j) => j.id)))} /> Select all</label>
            <span><b>{visible.length}</b> roles match your filters</span>
          </div>

          {loading ? <div className="empty">Loading…</div> : visible.length === 0 ? (
            <div className="empty">{jobs.length === 0 ? (meta?.refreshing ? 'Fetching the first batch of jobs… this takes about 10 seconds.' : 'No data yet. Click Refresh now.') : 'Nothing matches. Try Reset filters or tick "Experience not stated".'}</div>
          ) : (
            <ul className="cards">
              {visible.slice(0, 300).map((j) => (
                <JobCard key={j.id} job={j} score={scored.get(j.id)!} entry={store.tracker[j.id]} isNew={isNew(j)} checked={selected.has(j.id)} active={openId === j.id}
                  onCheck={() => setSelected((s) => { const n = new Set(s); if (n.has(j.id)) n.delete(j.id); else n.add(j.id); return n; })}
                  onOpen={() => setOpenId(j.id)} onStatus={(s) => void setStatus(j, s)} />
              ))}
            </ul>
          )}
          {visible.length > 300 && <p className="more">Showing the top 300. Narrow the filters to see the rest.</p>}

          {selected.size > 0 && (
            <div className="bulkbar" role="toolbar">
              <b>{selected.size} selected</b>
              <button className="btn" onClick={openTabs}>Open all in tabs</button>
              <button className="btn" onClick={() => void bulk('saved')}>Save</button>
              <button className="btn" onClick={() => void bulk('applied')}>Mark applied</button>
              <button className="btn" onClick={() => void bulk('ignored')}>Not for me</button>
              <button className="btn ghost" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}
        </main>
      )}

      {view === 'tracker' && <TrackerView jobs={jobs} store={store} onOpen={(id) => setOpenId(id)} onStatus={(j, s) => void setStatus(j, s)} />}
      {view === 'profile' && <ProfileView profile={profile} meta={meta} onSave={saveProfile} isDefault={!store.profile} />}
      {view === 'sources' && <SourcesView meta={meta} />}

      {openJob && (
        <Detail job={openJob} score={scored.get(openJob.id)!} entry={store.tracker[openJob.id]} isNew={isNew(openJob)} onClose={() => setOpenId(null)}
          onStatus={(s) => void setStatus(openJob, s)} onNote={(n) => void setNote(openJob, n)} />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Job card
function ScoreRing({ n, size = 46 }: { n: number; size?: number }) {
  const tone = n >= 75 ? 'hi' : n >= 55 ? 'mid' : 'lo';
  const r = (size - 6) / 2, c = 2 * Math.PI * r;
  return (
    <span className={`ring ${tone}`} style={{ width: size, height: size }} title={`Match score ${n}/100`}>
      <svg width={size} height={size}><circle cx={size / 2} cy={size / 2} r={r} className="bg" /><circle cx={size / 2} cy={size / 2} r={r} className="fg" strokeDasharray={`${(n / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} /></svg>
      <b>{n}</b>
    </span>
  );
}

function JobCard({ job: j, score, entry, isNew, checked, active, onCheck, onOpen, onStatus }: {
  job: Job; score: Score; entry?: TrackerEntry; isNew: boolean; checked: boolean; active: boolean; onCheck: () => void; onOpen: () => void; onStatus: (s: Status | null) => void;
}) {
  const sal = money(j.salary);
  const left = daysLeft(j.expiresAt);
  return (
    <li className={`card ${active ? 'active' : ''} ${j.closedAt ? 'closed' : ''} ${entry?.status === 'ignored' ? 'ign' : ''}`}>
      <input type="checkbox" className="pick" checked={checked} onChange={onCheck} aria-label={`Select ${j.title}`} />
      <ScoreRing n={score.total} />
      <div className="main" onClick={onOpen}>
        <div className="titleline">
          <h3 title={j.title}>{j.title.replace(/\s+/g, ' ')}</h3>
          {isNew && <span className="tag new">New</span>}
          {j.closedAt && <span className="tag closed">Closed</span>}
          {(j.reposts ?? 0) > 0 && <span className="tag dim">Reposted ×{(j.reposts ?? 0) + 1}</span>}
        </div>
        <div className="meta">
          <b>{j.company}</b>
          {j.postedBy && <span className="dim">via {j.postedBy}</span>}
          <span>{roleName(j.role)}</span>
          <span className={`lvl ${j.tier}`}>{j.tier === 'fresh' && j.flags.explicitGrad ? 'Fresh grad' : j.years !== null && j.tier !== 'unknown' ? (j.years === 0 ? 'No exp. needed' : `${j.years}+ yrs`) : TIER_LABEL[j.tier]}</span>
          {sal && <span>{sal}</span>}
          <span className="dim">{ago(j.postedAt)}</span>
          {j.applicants !== null ? <span className="dim">{j.applicants} applied</span> : j.views != null && <span className="dim">{j.views} views</span>}
          {left !== null && left >= 0 && left <= 7 && <span className="warn">closes in {left}d</span>}
          {j.flags.agency && <span className="tag dim">Agency</span>}
          {j.flags.needsChinese && <span className="tag dim">Chinese</span>}
        </div>
        {j.techs.length > 0 && (
          <div className="techs">
            {j.techs.slice(0, 9).map((t) => <span key={t} className={score.matched.includes(t) ? 'm' : score.partial.includes(t) ? 'p' : ''}>{t}</span>)}
            {j.techs.length > 9 && <span className="more">+{j.techs.length - 9}</span>}
          </div>
        )}
      </div>
      <div className="actions">
        <select className={`status ${entry?.status ?? 'none'}`} value={entry?.status ?? ''} onChange={(e) => onStatus((e.target.value || null) as Status | null)} aria-label="Status">
          <option value="">Track…</option>
          {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <a className="btn small" href={j.applyUrl || j.url} target="_blank" rel="noreferrer" onClick={() => { if (!entry) onStatus('saved'); }}>Open ↗</a>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- Detail drawer
function Detail({ job: j, score, entry, isNew, onClose, onStatus, onNote }: {
  job: Job; score: Score; entry?: TrackerEntry; isNew: boolean; onClose: () => void; onStatus: (s: Status | null) => void; onNote: (n: string) => void;
}) {
  const [note, setNote] = useState(entry?.note ?? '');
  useEffect(() => setNote(entry?.note ?? ''), [j.id, entry?.note]);
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  const p = score.parts;
  const bars: [string, number, number][] = [['Role preference', p.role, 40], ['Skill overlap', p.skills, 35], ['Fresh-grad fit', p.level, 15], ['Timing & competition', p.timing, 10]];
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={j.title}>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
        <div className="dhead">
          <ScoreRing n={score.total} size={64} />
          <div>
            <h2>{j.title}</h2>
            <p><b>{j.company}</b>{j.postedBy ? ` · via ${j.postedBy}` : ''} · {j.location}</p>
            <p className="dim">{j.source} · posted {ago(j.postedAt)}{j.expiresAt ? ` · closes ${j.expiresAt}` : ''}{isNew ? ' · new' : ''}</p>
          </div>
        </div>
        <div className="dact">
          <a className="btn primary" href={j.applyUrl || j.url} target="_blank" rel="noreferrer" onClick={() => { if (!entry) onStatus('saved'); }}>Open posting ↗</a>
          <select className={`status ${entry?.status ?? 'none'}`} value={entry?.status ?? ''} onChange={(e) => onStatus((e.target.value || null) as Status | null)}>
            <option value="">Not tracked</option>
            {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>

        <h4>Why this score</h4>
        <ul className="why">{score.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        <div className="bars">
          {bars.map(([l, v, max]) => (
            <div key={l}><span>{l}</span><div className="bar"><i style={{ width: `${(v / max) * 100}%` }} /></div><em>{v}/{max}</em></div>
          ))}
          {p.penalty < 0 && <div><span>Penalties</span><div className="bar neg"><i style={{ width: '100%' }} /></div><em>{p.penalty}</em></div>}
        </div>

        <h4>Skills they mention</h4>
        <div className="techs big">
          {j.techs.length === 0 && <span className="dim">None detected in the description.</span>}
          {score.matched.map((t) => <span key={t} className="m">{t}</span>)}
          {score.partial.map((t) => <span key={t} className="p">{t}</span>)}
          {score.missing.map((t) => <span key={t}>{t}</span>)}
        </div>
        <p className="legend"><span className="m">you know it</span><span className="p">familiar</span><span>gap</span></p>

        <h4>Notes</h4>
        <textarea rows={3} placeholder="Recruiter name, referral, deadline, how you applied…" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => { if (note !== (entry?.note ?? '')) onNote(note); }} />

        {entry?.history && entry.history.length > 0 && (
          <p className="dim hist">{entry.history.map((h) => `${statusLabel(h.status)} ${ago(h.at)}`).join(' → ')}</p>
        )}

        <h4>Description</h4>
        <pre className="desc">{j.desc || 'No description provided.'}</pre>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------- Tracker
function TrackerView({ jobs, store, onOpen, onStatus }: { jobs: Job[]; store: Store; onOpen: (id: string) => void; onStatus: (j: Job, s: Status | null) => void }) {
  const byId = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const cols = STATUSES.filter((s) => s.id !== 'ignored');
  const entries = Object.entries(store.tracker);
  const total = entries.filter(([, t]) => t.status !== 'ignored').length;
  const applied = entries.filter(([, t]) => ['applied', 'oa', 'interview', 'offer', 'rejected'].includes(t.status)).length;
  const exportCsv = () => {
    const rows = [['status', 'company', 'title', 'url', 'note', 'updated']];
    for (const [id, t] of entries) { const j = byId.get(id); rows.push([t.status, j?.company ?? t.job?.company ?? '', j?.title ?? t.job?.title ?? '', j?.url ?? t.job?.url ?? '', t.note ?? '', t.updatedAt]); }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'grad-radar-tracker.csv'; a.click();
  };
  if (entries.length === 0) return <main className="page"><div className="empty">Nothing tracked yet. Use "Track…" on a job in the Feed, or select several and click "Mark applied".</div></main>;
  return (
    <main className="page wide">
      <div className="pagehead"><div><h2>Application tracker</h2><p>{total} tracked · {applied} applied</p></div><button className="btn" onClick={exportCsv}>Export CSV</button></div>
      <div className="board">
        {cols.map((c) => {
          const items = entries.filter(([, t]) => t.status === c.id).sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt));
          return (
            <section key={c.id} className={`col ${c.tone}`}>
              <h3>{c.label} <em>{items.length}</em></h3>
              {items.map(([id, t]) => {
                const j = byId.get(id);
                const title = j?.title ?? t.job?.title ?? id;
                return (
                  <div key={id} className="kcard">
                    <div onClick={() => j && onOpen(id)} className={j ? 'clk' : ''}>
                      <b>{title}</b>
                      <span>{j?.company ?? t.job?.company}{j?.closedAt ? ' · closed' : !j ? ' · no longer listed' : ''}</span>
                      {t.note && <small>{t.note}</small>}
                      <small className="dim">{ago(t.updatedAt)}</small>
                    </div>
                    <div className="kact">
                      <select value={t.status} onChange={(e) => j ? onStatus(j, (e.target.value || null) as Status | null) : void 0} disabled={!j}>
                        {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        <option value="">Remove</option>
                      </select>
                      <a href={j?.url ?? t.job?.url} target="_blank" rel="noreferrer">Open ↗</a>
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- Profile
function ProfileView({ profile, meta, onSave, isDefault }: { profile: Profile; meta: Meta | null; onSave: (p: Profile) => Promise<void>; isDefault: boolean }) {
  const [p, setP] = useState(profile);
  const [saved, setSaved] = useState(false);
  useEffect(() => setP(profile), [profile]);
  const cat = meta?.techCatalog ?? [];
  const save = async () => { await onSave(p); setSaved(true); window.setTimeout(() => setSaved(false), 2000); };
  return (
    <main className="page">
      <div className="pagehead"><div><h2>My profile</h2><p>{isDefault ? 'Pre-filled from your resume. Changes re-rank the feed instantly.' : 'Saved. Changes re-rank the feed instantly.'}</p></div><button className="btn primary" onClick={() => void save()}>{saved ? 'Saved ✓' : 'Save profile'}</button></div>
      <section className="panel">
        <h3>Role preference</h3>
        <p className="dim">How much you want each type of role. This is 40% of the match score.</p>
        {ROLE_ORDER.filter((r) => r !== 'other').map((r) => (
          <label key={r} className="slider"><span>{roleName(r)}</span>
            <input type="range" min={0} max={1} step={0.05} value={p.rolePrefs[r] ?? 0} onChange={(e) => setP({ ...p, rolePrefs: { ...p.rolePrefs, [r]: Number(e.target.value) } })} />
            <em>{Math.round((p.rolePrefs[r] ?? 0) * 100)}%</em></label>
        ))}
      </section>
      <section className="panel">
        <h3>Skills</h3>
        <p className="dim">Click to cycle: none → familiar → strong → none. Strong counts fully, familiar counts 60%.</p>
        <div className="techs big skill-picker" role="group" aria-label="Skill proficiency">
          {cat.map((t) => <button key={t} type="button" title={`${t}: ${p.strong.includes(t) ? 'strong' : p.familiar.includes(t) ? 'familiar' : 'none'}. Click to change.`} className={p.strong.includes(t) ? 'm' : p.familiar.includes(t) ? 'p' : ''} onClick={() => setP((q) => {
            const s = q.strong.includes(t), f = q.familiar.includes(t);
            if (!s && !f) return { ...q, familiar: [...q.familiar, t] };
            if (f) return { ...q, familiar: q.familiar.filter((x) => x !== t), strong: [...q.strong, t] };
            return { ...q, strong: q.strong.filter((x) => x !== t) };
          })}>{t}</button>)}
        </div>
        <p className="legend"><span className="m">strong</span><span className="p">familiar</span><span>none</span></p>
      </section>
      <section className="panel">
        <label className="check"><input type="checkbox" checked={p.penalizeAgency} onChange={(e) => setP({ ...p, penalizeAgency: e.target.checked })} /> Lower the score of recruitment-agency posts (they often repost the same role and hide the employer)</label>
        <button className="link" onClick={() => setP(DEFAULT_PROFILE)}>Reset to resume defaults</button>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------- Sources
function SourcesView({ meta }: { meta: Meta | null }) {
  const [manual, setManual] = useState<{ name: string; url: string; note: string }[]>([]);
  useEffect(() => { void api.sources().then((s) => setManual(s.manual)); }, []);
  const srcs = meta?.sources ?? [];
  return (
    <main className="page">
      <div className="pagehead"><div><h2>Sources and coverage</h2><p>What is checked on every refresh, and what you still have to check by hand.</p></div></div>
      <section className="panel">
        <h3>Checked automatically</h3>
        <table className="tbl"><thead><tr><th>Source</th><th>Status</th><th>Candidate postings</th></tr></thead>
          <tbody>{srcs.map((s) => <tr key={s.name}><td>{s.name}</td><td className={s.ok ? 'okc' : 'errc'}>{s.ok ? 'OK' : `Failed: ${s.error}`}</td><td>{s.ok ? s.count : '—'}</td></tr>)}</tbody></table>
        <p className="dim">"Candidate postings" are software-type roles in Singapore before the fresh-grad and role filters are applied. MyCareersFuture is searched with its Fresh/entry level and Junior Executive filters.</p>
      </section>
      <section className="panel">
        <h3>Check these by hand</h3>
        <p className="dim">These portals are not directly integrated in this prototype. Check them yourself for roles the automatic feed may miss. Some of their postings may also appear through MyCareersFuture.</p>
        <ul className="manual">{manual.map((m) => <li key={m.name}><a href={m.url} target="_blank" rel="noreferrer">{m.name} ↗</a><span>{m.note}</span></li>)}</ul>
      </section>
      <section className="panel">
        <h3>Government jobs: not complete coverage</h3>
        <p>MyCareersFuture is government-run, but it is not a complete feed of public-service vacancies. Careers@Gov and agency career sites are not searched automatically by this app.</p>
        <p className="dim">Use the Careers@Gov, GovTech and Public-sector tech careers links above to check public-sector opportunities. Entry-level classification in the feed is a best-effort inference, not an eligibility guarantee.</p>
      </section>
    </main>
  );
}
