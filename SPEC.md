# Grad Radar SG: product spec

**One line:** a local app that finds every open fresh-grad software, full-stack and agent/applied-AI role in Singapore, ranks them against Shaoheng's resume, and tracks his applications.

## Problems it solves

1. He can't see all the relevant open roles in one place, so he can't apply to everything in one pass.
2. Job titles and seniority are noisy: many "Software Engineer" posts need 3 to 5 years, and many are recruiter agency posts.
3. He loses track of where he has applied.

## Scope (3-hour prototype)

| Area | Decision |
|---|---|
| Data sources | MyCareersFuture (government portal, "Fresh/entry level" and "Junior Executive" filters) plus company job boards on Greenhouse, Lever, Ashby and SmartRecruiters for about 30 companies hiring in Singapore |
| Not covered | ByteDance/TikTok, Shopee/Sea and big-tech sites with no public API. The Sources tab lists them as manual links. |
| Filtering | Drop senior titles and roles asking 3+ years. Hide internships, ML roles and recruiter agency posts by default, each with a toggle. |
| Role types | Full-stack, backend, frontend, AI/agent, general software engineer, plus hidden-by-default mobile, data, devops, QA, security, ML |
| Match score | 0 to 100, computed in the browser so editing the profile re-ranks instantly. It combines role preference (40), skill overlap with the job description (35), fresh-grad signal (15) and timing/competition (10), minus a penalty for agency posts. The "why" is always shown. |
| Tracker | Saved, Applied, OA, Interview, Offer, Rejected, Ignored, with notes. Stored in a local file, not only in the browser. |
| Batch action | Select many roles and open them all in tabs, mark applied, or save. |
| Auto-update | The server refreshes on start and every 6 hours while running, and on demand. A "New" badge marks roles first seen since you last marked all as seen. Roles that disappear are flagged "Closed". `npm run refresh` updates the data without the UI, so it can be run from Windows Task Scheduler. |
| Out of scope | Auto-submitting applications (every ATS has its own login/CAPTCHA and it breaks their terms), interview prep, accounts. |

## Architecture

```
server/            Node 20, no framework
  sources.mjs      one fetcher per job board, normalised to one shape
  enrich.mjs       role classifier, years-of-experience parser, tech extractor, flags
  refresh.mjs      runs all sources, merges with the previous snapshot (firstSeen, closedAt)
  index.mjs        HTTP API + serves the built UI + scheduler
data/              jobs.json (snapshot), store.json (tracker, profile, state)
src/               React + TypeScript UI (Vite)
```

## Honest limits

- Seniority and years are inferred from titles and text, so some roles will be mislabelled. Every card links to the original posting.
- Only open roles that a source publishes are shown. "All jobs in Singapore" is not possible; coverage is listed on the Sources tab.
- Background refresh only runs while the server runs (or via Task Scheduler).
