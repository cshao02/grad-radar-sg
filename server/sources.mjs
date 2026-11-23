// One fetcher per job board. Every fetcher returns jobs in the same normalised shape:
// { id, source, company, title, location, url, applyUrl, postedAt, expiresAt, salary, description,
//   sourceMinYears, sourceLevel, employmentTypes, applicants, agencyHint }
import { htmlToText } from './enrich.mjs';

const UA = 'Mozilla/5.0 (GradRadarSG personal job tracker)';
const SWEISH = /engineer|developer|software|programmer|\bsde\b|\bswe\b|full[\s-]?stack|back[\s-]?end|front[\s-]?end|coder|\bweb\b|\bapi\b|technolog/i;

async function getJson(url, opts = {}, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        ...opts,
        headers: { 'user-agent': UA, accept: 'application/json', ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) },
        signal: AbortSignal.timeout(25000),
      });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return await r.json();
    } catch (e) {
      err = e;
      await new Promise((res) => setTimeout(res, 600 * (i + 1)));
    }
  }
  throw err;
}

export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        try { out[k] = await fn(items[k], k); } catch { out[k] = null; }
      }
    }),
  );
  return out;
}

// ---------------- MyCareersFuture ----------------
const MCF_QUERIES = [
  'software engineer', 'software developer', 'full stack', 'backend', 'frontend', 'web developer',
  'java developer', 'python developer', 'golang', 'react', 'typescript', 'node',
  'ai engineer', 'llm', 'agent', 'graduate software', 'associate software engineer', 'junior developer', 'application developer',
];
const MCF_LEVELS = ['Fresh/entry level', 'Junior Executive'];

export async function fetchMcf(prev = new Map()) {
  const seen = new Map();
  for (const level of MCF_LEVELS) {
    await pool(MCF_QUERIES, 4, async (q) => {
      for (let page = 0; page < 6; page++) {
        const body = JSON.stringify({ search: q, sortBy: ['new_posting_date'], positionLevels: [level] });
        const res = await getJson(`https://api.mycareersfuture.gov.sg/v2/search?limit=100&page=${page}`, { method: 'POST', body });
        for (const r of res.results || []) seen.set(r.uuid, { r, level });
        if ((res.results || []).length < 100) break;
      }
    });
  }
  const cands = [...seen.values()].filter(({ r }) => SWEISH.test(r.title || ''));
  const jobs = await pool(cands, 8, async ({ r, level }) => {
    const id = `mcf:${r.uuid}`;
    // the search endpoint reports 0 applicants for everything; the detail endpoint has the real count,
    // the description and the employer's minimum years of experience
    const d = await getJson(`https://api.mycareersfuture.gov.sg/v2/jobs/${r.uuid}`);
    const description = htmlToText(d.description || '');
    const minYears = typeof d.minimumYearsExperience === 'number' ? d.minimumYearsExperience : null;
    const m = { ...(r.metadata || {}), ...(d.metadata || {}) };
    const comp = r.postedCompany?.name || r.hiringCompany?.name || 'Unknown';
    const hiring = r.hiringCompany?.name;
    return {
      id, source: 'MyCareersFuture', company: hiring || comp, postedBy: hiring && hiring !== comp ? comp : undefined,
      title: r.title, location: r.address?.districts?.[0]?.location?.replace(/^D\d+\s*/, '') || 'Singapore',
      url: m.jobDetailsUrl, applyUrl: m.jobDetailsUrl,
      postedAt: m.newPostingDate || m.originalPostingDate || null, expiresAt: m.expiryDate || null,
      salary: r.salary?.minimum ? { min: r.salary.minimum, max: r.salary.maximum, period: 'month', currency: 'SGD' } : null,
      description, sourceMinYears: minYears, sourceLevel: level,
      employmentTypes: (r.employmentTypes || []).map((e) => e.employmentType),
      applicants: m.totalNumberJobApplication > 0 ? m.totalNumberJobApplication : null, views: typeof m.totalNumberOfView === 'number' ? m.totalNumberOfView : null,
      agencyHint: Boolean(m.isPostedOnBehalf),
    };
  });
  return jobs.filter(Boolean);
}

// ---------------- Greenhouse ----------------
export async function fetchGreenhouse(slug, name) {
  const list = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
  const sg = (list.jobs || []).filter((j) => /singapore/i.test(j.location?.name || '') && SWEISH.test(j.title));
  const jobs = await pool(sg, 6, async (j) => {
    const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${j.id}`);
    return {
      id: `gh:${slug}:${j.id}`, source: `${name} careers`, company: name, title: j.title,
      location: j.location?.name || 'Singapore', url: j.absolute_url, applyUrl: j.absolute_url,
      // Greenhouse "first_published" can be years old for evergreen roles; updated_at reflects the live posting
      postedAt: (j.updated_at || d.updated_at || j.first_published || '').slice(0, 10) || null, expiresAt: null, salary: null,
      description: htmlToText(d.content || '', { escaped: true }), sourceMinYears: null, sourceLevel: null, employmentTypes: [], applicants: null,
    };
  });
  return jobs.filter(Boolean);
}

// ---------------- Lever ----------------
export async function fetchLever(slug, name) {
  const list = await getJson(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  return list
    .filter((j) => (j.categories?.allLocations || [j.categories?.location]).some((l) => /singapore/i.test(l || '')) && SWEISH.test(j.text))
    .map((j) => ({
      id: `lv:${slug}:${j.id}`, source: `${name} careers`, company: name, title: j.text,
      location: j.categories?.location || 'Singapore', url: j.hostedUrl, applyUrl: j.applyUrl || j.hostedUrl,
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : null, expiresAt: null, salary: null,
      description: [j.descriptionPlain, ...(j.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`), j.additionalPlain].filter(Boolean).join('\n\n'),
      sourceMinYears: null, sourceLevel: null, employmentTypes: [j.categories?.commitment].filter(Boolean), applicants: null,
    }));
}

// ---------------- Ashby ----------------
export async function fetchAshby(slug, name) {
  const b = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`);
  return (b.jobs || [])
    .filter((j) => j.isListed !== false && (/singapore/i.test(j.location || '') || (j.secondaryLocations || []).some((l) => /singapore/i.test(l.location || ''))) && SWEISH.test(j.title))
    .map((j) => ({
      id: `ab:${slug}:${j.id}`, source: `${name} careers`, company: name, title: j.title,
      location: /singapore/i.test(j.location || '') ? j.location : 'Singapore', url: j.jobUrl, applyUrl: j.applyUrl || j.jobUrl,
      postedAt: (j.publishedAt || '').slice(0, 10) || null, expiresAt: null, salary: null,
      description: j.descriptionPlain || htmlToText(j.descriptionHtml || ''), sourceMinYears: null, sourceLevel: null,
      employmentTypes: [j.employmentType].filter(Boolean), applicants: null,
    }));
}

// ---------------- SmartRecruiters ----------------
export async function fetchSmartRecruiters(slug, name) {
  const all = [];
  for (let offset = 0; offset < 600; offset += 100) {
    const p = await getJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100&offset=${offset}&country=sg`);
    all.push(...(p.content || []));
    if ((p.content || []).length < 100) break;
  }
  const sg = all.filter((j) => SWEISH.test(j.name));
  const jobs = await pool(sg, 6, async (j) => {
    const d = await getJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings/${j.id}`);
    const sec = d.jobAd?.sections || {};
    const text = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation'].map((k) => htmlToText(sec[k]?.text || '')).filter(Boolean).join('\n\n');
    const level = j.experienceLevel?.id || null;
    const isIntern = level === 'internship' || j.typeOfEmployment?.id === 'intern';
    return {
      id: `sr:${slug}:${j.id}`, source: `${name} careers`, company: name, title: j.name,
      location: j.location?.city || 'Singapore', url: d.postingUrl || `https://jobs.smartrecruiters.com/${slug}/${j.id}`, applyUrl: d.applyUrl || d.postingUrl,
      postedAt: (j.releasedDate || '').slice(0, 10) || null, expiresAt: (j.unpublishOn || '').slice(0, 10) || null, salary: null,
      description: text, sourceMinYears: null, sourceLevel: level,
      employmentTypes: [isIntern ? 'Internship' : j.typeOfEmployment?.label].filter(Boolean), applicants: null,
    };
  });
  return jobs.filter(Boolean);
}

// ---------------- registry ----------------
// Companies chosen because they hire software engineers in Singapore and expose a public job board API.
export const COMPANY_SOURCES = [
  ['greenhouse', 'stripe', 'Stripe'], ['greenhouse', 'databricks', 'Databricks'], ['greenhouse', 'datadog', 'Datadog'],
  ['greenhouse', 'okx', 'OKX'], ['greenhouse', 'binance', 'Binance'], ['greenhouse', 'coinbase', 'Coinbase'],
  ['greenhouse', 'jumptrading', 'Jump Trading'], ['greenhouse', 'janestreet', 'Jane Street'], ['greenhouse', 'virtu', 'Virtu Financial'],
  ['greenhouse', 'gitlab', 'GitLab'], ['greenhouse', 'xendit', 'Xendit'], ['greenhouse', 'anthropic', 'Anthropic'],
  ['greenhouse', 'agoda', 'Agoda'], ['greenhouse', 'ripple', 'Ripple'], ['greenhouse', 'thunes', 'Thunes'],
  ['greenhouse', 'twilio', 'Twilio'], ['greenhouse', 'mongodb', 'MongoDB'], ['greenhouse', 'elastic', 'Elastic'],
  ['greenhouse', 'figma', 'Figma'], ['greenhouse', 'cloudflare', 'Cloudflare'],
  ['lever', 'ninjavan', 'Ninja Van'], ['lever', 'crypto', 'Crypto.com'], ['lever', 'lalamove', 'Lalamove'], ['lever', 'nium', 'Nium'],
  ['ashby', 'airwallex', 'Airwallex'], ['ashby', 'openai', 'OpenAI'], ['ashby', 'sierra', 'Sierra'], ['ashby', 'harvey', 'Harvey'],
  ['ashby', 'notion', 'Notion'], ['ashby', 'cohere', 'Cohere'],
  ['smartrecruiters', 'grab', 'Grab'], ['smartrecruiters', 'deliveryhero', 'Delivery Hero'], ['smartrecruiters', 'wise', 'Wise'],
];

export const MANUAL_SOURCES = [
  { name: 'TikTok / ByteDance', url: 'https://joinbytedance.com/search?location=CT_75&category=6709824272505768200', note: 'Not directly integrated. Check Singapore + Technology; some roles also appear via MyCareersFuture.' },
  { name: 'Shopee / Sea Group', url: 'https://careers.shopee.sg/jobs', note: 'Not directly integrated. Filter by Singapore and Technology.' },
  { name: 'Google', url: 'https://www.google.com/about/careers/applications/jobs/results/?location=Singapore&target_level=EARLY', note: 'Early-career filter.' },
  { name: 'Microsoft', url: 'https://jobs.careers.microsoft.com/global/en/search?lc=Singapore&exp=Students%20and%20graduates', note: 'Students and graduates filter.' },
  { name: 'Amazon', url: 'https://www.amazon.jobs/en/search?base_query=software+development+engineer&loc_query=Singapore', note: 'SDE I roles.' },
  { name: 'Meta', url: 'https://www.metacareers.com/jobs?offices[0]=Singapore', note: 'Singapore office.' },
  { name: 'Careers@Gov', url: 'https://jobs.careers.gov.sg/', note: 'Singapore Public Service vacancies. Not searched automatically; check software, developer and graduate opportunities here.' },
  { name: 'GovTech', url: 'https://www.tech.gov.sg/careers/', note: 'GovTech opportunities and student/graduate programmes. Links to GovTech vacancies on Careers@Gov.' },
  { name: 'Public-sector tech careers', url: 'https://techcareers.smartnation.gov.sg/', note: 'Official government technology careers hub with links to hiring agencies. Not an automated source in this app.' },
];

const FETCHERS = { greenhouse: fetchGreenhouse, lever: fetchLever, ashby: fetchAshby, smartrecruiters: fetchSmartRecruiters };

export function companyFetch([kind, slug, name]) {
  return () => FETCHERS[kind](slug, name);
}
