# Grad Radar SG

A local web app that finds open fresh-grad **software, full-stack and agent / applied-AI** roles in Singapore, scores each one against your resume, and tracks your applications.

Built for Chen Shaoheng (NUS CS, graduating May 2027). The product reasoning is in [SPEC.md](./SPEC.md); the ideation that led to it is in `IDEATION.md` and `IDEATION-job-hunt.md` one level above `outputs/`.

## Run it

Requires Node 20+.

```powershell
cd outputs\grad-radar-sg
npm install
npm run build
npm start          # http://127.0.0.1:4317
```

The first start fetches live data (about 10 seconds) and writes it to `data/jobs.json`. Your tracker, profile and "last seen" marker live in `data/store.json`; both files are plain JSON and are never sent anywhere.

Development mode (hot reload on http://127.0.0.1:5173, API proxied to 4317):

```powershell
npm run dev:server   # terminal 1
npm run dev:ui       # terminal 2
```

> If Node fails with a `lstat`/`EPERM` error on your user folder (seen in sandboxed shells), run with `NODE_OPTIONS="--preserve-symlinks --preserve-symlinks-main"`.

## What you get

- **Feed**: roles ranked by match score, with filters for role type, experience tier, source, agencies and internships. Search by title, company or technology. Select several and open them all in tabs, or mark them saved / applied / not for me in one click.
- **Detail drawer**: why the score is what it is (role, skills, fresh-grad fit, timing), which skills you match, notes and status history.
- **Tracker**: Saved, Applied, OA, Interview, Offer, Rejected and Not for me, with CSV export.
- **My profile**: role-preference sliders and a skill list pre-filled from the resume. Changes re-rank the feed instantly.
- **Sources**: per-source health of the last refresh, plus links for employers with no public feed.

## Does it update automatically?

Yes, while the server is running:

- It refreshes on start if the data is more than 1 hour old, then every 6 hours (`REFRESH_HOURS` env var), and whenever you press **Refresh now**.
- Roles first seen since you last pressed **Mark all seen** get a **New** badge.
- Roles that vanish from a source, or pass their MyCareersFuture expiry date, are marked **Closed** and kept for 14 days so your tracker does not lose them.
- If one source fails, its previous jobs are kept rather than wrongly closed.

If the server is not running, nothing updates. For updates while the app is closed, schedule the headless refresh with Windows Task Scheduler, for example daily:

```powershell
schtasks /Create /SC DAILY /ST 08:00 /TN "GradRadarRefresh" /TR "cmd /c cd /d C:\path\to\outputs\grad-radar-sg && npm run refresh"
```

## How the score works (0 to 100)

| Part | Points | How |
| --- | --- | --- |
| Role preference | 40 | Your slider for the role type (full-stack 100%, backend 85%, AI/agent 75%, ML 0% by default). |
| Skill overlap | 35 | Technologies named in the description. Strong skills count fully, familiar 60%, generic ones (REST, SQL, Linux) half. Few mentioned skills pull toward neutral. |
| Fresh-grad fit | 15 | Explicit graduate titles score highest, then entry level, then 1 to 2 years, then unknown. Senior scores 0. |
| Timing and competition | 10 | Newer postings and less crowded ones score higher. |
| Penalties | up to -18 | Recruitment agency posts (-6, toggle in profile) and diploma / polytechnic-only roles (-12). |

Role type, years of experience and skills are **inferred from titles and descriptions with rules**, not read from structured fields, so expect some mistakes. The score is a ranking aid, not a verdict.

## Data sources

- **MyCareersFuture** (Fresh/entry level and Junior Executive filters, the largest source).
- **Greenhouse, Lever, Ashby and SmartRecruiters** boards for about 30 companies hiring in Singapore, including Grab, OKX, Airwallex, Binance, Stripe, Wise, OpenAI, Sierra, Delivery Hero and Jane Street. Add more in `COMPANY_SOURCES` in `server/sources.mjs`.
- TikTok/ByteDance graduate roles appear through MyCareersFuture. Shopee, Google, Microsoft, Amazon, Meta and GovTech have no public API and are listed under **Sources** as manual links.

## Honest limits

- It does **not** submit applications. Open Posting takes you to the employer's page.
- MyCareersFuture hides applicant counts in its public API, so "competition" uses view counts as a rough proxy.
- Some Greenhouse boards post evergreen roles; dates use the posting's last update rather than first publish.
- Only the listed companies are covered. A role at a company not on the list or the manual links will not appear.
- Background refresh needs the server (or Task Scheduler) to be running.

## Layout

```
server/   sources.mjs (fetchers) · enrich.mjs (classify, tiers, techs) · refresh.mjs (merge, close, dedupe) · index.mjs (API + static)
src/      lib.ts (types, scoring, API client) · App.tsx (Feed, Detail, Tracker, Profile, Sources) · styles.css
data/     jobs.json (snapshot) · store.json (tracker, profile)
```
