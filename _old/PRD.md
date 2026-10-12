# PRD — Job Radar (personal job-alert pipeline)

Owner: Anupam Kalita · Status: ready to build · Last updated: 2026-10-12

## 1. Problem
The PM roles that fit Anupam best (companies building for HR: HRIS, HRMS, payroll, HR tech) show up in
three places that no single job board covers:
1. company careers pages,
2. LinkedIn posts from people at those companies ("we're hiring a PM…"),
3. remote job boards.
Checking all three by hand every day is slow, and most results are the wrong level, the wrong
location, or the wrong domain.

## 2. Goal
Every 30 minutes, add any new **relevant** role to a Google Sheet with:
- a **resume match %** (computed, repeatable),
- the **gaps**, split into "reword your resume" vs. "real gap",
- a one-line reason it fits, plus links to the JD and the source post.

### Success metric (checked after week 1)
Of the top 10 rows by match % each day, **at least 3** are roles Anupam would actually apply to.
If it's lower, fix triage and scoring before adding any more sources.

### Non-goals (v1)
- No website, UI, or app. The Sheet *is* the interface.
- No auto-applying, no auto-messaging hiring managers.
- No X/Twitter in v1. Posts there rarely get indexed by Google, and X's API is expensive. Revisit after week 1.
- No resume rewriting. The tool only *suggests* keywords.

## 3. Who counts as a target company
**Anyone building for HR or HR teams.** Categories (from `COMPANIES_SEED.md`):
HRIS/HRMS/HCM · payroll & EOR/global employment · recruiting/ATS & talent · benefits & employee wellbeing ·
performance/engagement/L&D · workforce management (time, attendance, scheduling) · background verification ·
HR unified APIs & integrations · AI for HR · compliance/statutory for HR · earned-wage access & employee finance.

The **Companies** tab in the Sheet is the source of truth. It starts from `COMPANIES_SEED.md`
and grows on its own: when LinkedIn or remote-board sourcing finds a role at an HR-building company that
isn't listed yet, triage adds it with `added_by = discovered` (§4.4).

## 4. Sources

### 4.1 Company job boards (every 30 min, free)
For each company in the Companies tab with a known board, call the public job-board endpoint:

| ATS | Endpoint pattern (verify each during the build) |
|---|---|
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` |
| Lever | `https://api.lever.co/v0/postings/{slug}?mode=json` |
| Ashby | `https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true` |
| Workable | `https://apply.workable.com/api/v3/accounts/{slug}/jobs` (POST) |
| SmartRecruiters | `https://api.smartrecruiters.com/v1/companies/{slug}/postings` |
| Recruitee | `https://{slug}.recruitee.com/api/offers/` |
| Personio | `https://{slug}.jobs.personio.de/xml` |

Companies on other systems (e.g. Darwinbox, Keka Hire, Zoho Recruit, custom careers pages):
mark `ats = other` and cover them through §4.2 (Serper search `site:{careers-domain} "product manager"`),
run every 2 hours.

Pre-filter by **title in code** before any LLM call: keep titles containing
`product manager | product owner | technical product manager | PM` and drop
`product marketing | project manager | program manager | product designer | product analyst`.

### 4.2 LinkedIn hiring posts via Google (every 2 hours, Serper)
Google takes hours to index LinkedIn posts, so searching every 30 min would just return the same results.
Queries come from `config.yaml` with Google's past-24h filter (`tbs=qdr:d`). Starting set:
```
site:linkedin.com/posts ("hiring" OR "we're hiring" OR "join my team") "product manager" (HRIS OR HRMS OR "HR tech" OR HRtech)
site:linkedin.com/posts ("hiring" OR "we're hiring") "product manager" (payroll OR EOR OR "global employment")
site:linkedin.com/posts ("hiring" OR "we're hiring") "product manager" (recruiting OR ATS OR "talent acquisition" OR "people platform")
site:linkedin.com/posts ("hiring" OR "we're hiring") "product manager" (benefits OR "employee experience" OR "workforce management")
site:linkedin.com/posts "hiring" "product manager" remote India (HR OR payroll OR people)
site:linkedin.com/jobs/view "product manager" (HRIS OR payroll OR "HR tech") remote
```
Plus one query per company tagged `priority = high` in the Companies tab:
`site:linkedin.com/posts "{company}" ("hiring" OR "we're hiring") "product manager"`
(spread across runs so each high-priority company is searched once a day).

For each result, keep: post URL, poster name + headline (from the title/snippet), snippet text, date.
Then the JD resolver (§4.5) tries to find the full JD.

### 4.3 Remote job boards (every 30 min, free)
- RemoteOK JSON API, Remotive API (category: product), WeWorkRemotely product RSS.
- Hacker News "Who is hiring?" (monthly thread, via the Algolia API): re-check new comments every 2 hours.
These sources cover all kinds of companies, so triage (§5) decides whether the company builds for HR.

### 4.4 Discovery
If triage says a role passes, the company builds for HR, and the company isn't in the Companies tab:
append it with `added_by = discovered`, `priority = normal`, and try to detect its ATS from the apply URL
(e.g. `boards.greenhouse.io/{slug}` → Greenhouse + slug).

### 4.5 JD resolver
Order of attempts:
1. If the source is an ATS endpoint: the JD is already in the response.
2. If the post has an apply link (`lnkd.in`, ATS URL, careers page): follow redirects, fetch the page,
   extract the main text. If it's an ATS URL, use that ATS's API instead of scraping HTML.
3. If the link is a Google Form, a "DM me" or "email me" ask, or a page needing login: no JD.
   Score fit only and set `JD status = not found`. Match % stays blank, not 0.

## 5. Triage (cheap model; one call per new candidate)
Prompt: `PROMPTS.md › P1`. Returns JSON. A role **passes** only if all four checks are true:

| Check | Pass rule |
|---|---|
| Is a real PM role | PM / TPM / Product Owner at a product company. Not marketing, project, program, design, analyst. For posts: an actual hiring post, not a "congrats on the new role" or "open to work" post. |
| Company builds for HR | Primary product serves HR teams or employees-as-workforce (see §3 categories). If unsure → pass, with `hr_confidence = low`. |
| Mid-level | Asks for about 3–7 yrs **or** the title is PM / PM II / Product Manager – X with no years given. "Senior PM" passes only if it asks for ≤6 yrs; label it `level = stretch`. Drop APM/Associate/Intern and Lead/Principal/Group/Director/Head/VP. |
| Location works from India | See below. |

**Location rule:**
- ✅ Remote with India allowed: "anywhere", "worldwide", "India", "APAC", "Asia", "EMEA & APAC", or a stated time-zone band that includes IST (UTC+5:30).
- ✅ Remote where the required overlap is reachable from IST: hours based in Europe, the Middle East or APAC, or "4 hours overlap with CET" and similar.
- ✅ Based in India (any city): onsite, hybrid or remote. *(Assumption: India-based onsite/hybrid counts. Change it in `TARGET_PROFILE.md` if not.)*
- ❌ "US only", "must be authorized to work in the US/UK/EU" without sponsorship, or US-hours overlap of 6+ hours.
- ❓ Unclear → pass, with `location = unclear` so Anupam can decide.

Failed roles go to the **Filtered out** tab with the reason (kept 14 days), so the filters can be audited.

## 6. Scoring (stronger model, only for roles that pass triage)

### 6.1 Keyword extraction — `PROMPTS.md › P2`
From the JD, extract 12–25 keywords as JSON:
`{term, type: must|nice, synonyms: [..]}`.
Cache the result per job ID so the same JD always gets the same list.

### 6.2 Resume match % — computed in code
- Normalize the resume text and the keywords (lowercase, strip punctuation, collapse whitespace;
  treat "HRMS/HRIS" style slashes as separate terms).
- A keyword is **matched** if the term or any synonym appears in the resume text (word-boundary match).
- `match % = (2 × matched_must + 1 × matched_nice) / (2 × total_must + 1 × total_nice) × 100`, rounded.
- Same resume + same JD = same number, every time.

### 6.3 Gaps — `PROMPTS.md › P3`
For every **unmatched** keyword, the model classifies it using the resume as evidence:
- **Reword** — the resume already proves it under different words. Must quote the resume line it's based on
  and suggest the wording. Example: JD says "Workday integrations"; resume says "ERP integrations…" →
  suggest "ERP/HCM integrations (Workday-style)" only if that's true.
- **Real gap** — no evidence in the resume. Never suggest adding it.
Any "reword" item without a verbatim resume quote is automatically downgraded to "real gap".

### 6.4 Fit score & reason — same call as P3
`fit 0–100` against `TARGET_PROFILE.md` (domain, PM type, level, location), plus `why`: one line, max 20 words.

### 6.5 What makes it into Matches
Every role that passes triage goes into **Matches**, sorted by match %. Rows get highlighted:
- **Green**: match % ≥ 90 → apply as is.
- **Yellow**: 70–89 → check "Reword" gaps first.
- **No colour**: < 70, or JD not found.

## 7. Google Sheet layout

**Tab `Matches`** (append-only; the script never edits existing rows)
| Column | Notes |
|---|---|
| Found at (IST) | timestamp |
| Company | |
| Role | as written |
| Level | mid / stretch |
| Location | as written + rule result (remote-India / overlap-OK / India-based / unclear) |
| Match % | blank if JD not found |
| Fit | 0–100 |
| Why it fits | one line |
| Gaps – reword | "JD term → suggested wording (resume: '…')" |
| Gaps – real | comma list |
| Matched keywords | comma list |
| Source | ATS / LinkedIn post / LinkedIn job / RemoteOK / Remotive / WWR / HN |
| Posted by | for posts: name + headline |
| JD link | |
| Post link | for posts |
| JD status | full / snippet only / not found |
| Status | dropdown: New / Applied / Messaged / Skip / Interviewing. Filled only by Anupam. |
| Notes | filled only by Anupam |
| job_id | hash of normalized (company + role + url) |

**Tab `Filtered out`**: found at, company, role, source, link, failed check, reason. Rows older than 14 days get pruned.

**Tab `Companies`** (Anupam can add rows by hand): name, category, website, ats, slug, careers_url,
priority (high/normal), added_by (seed/discovered/manual), last_checked, roles_found_total, active (Y/N).

**Tab `_seen`** (hidden): job_id, first_seen. The dedupe store.

**Tab `Runs`**: run time, per-source counts (found / new / passed / failed), LLM cost estimate, errors.
This tab answers "is it working?" at a glance.

## 8. Schedule & budget
- GitHub Actions cron `*/30 * * * *`. [Note: GitHub can delay scheduled runs by several minutes when busy; that's fine.]
- Every run: job boards (§4.1), remote boards (§4.3).
- Every 4th run (about every 2h): Serper sources (§4.2, plus the `ats = other` searches), HN re-check.
- **Free-minutes budget**: private repos get 2,000 Actions minutes/month. 48 runs/day ≈ 1,440 runs/month,
  so a typical run must finish in about 1 minute. Keep it fast: install dependencies from a cached
  requirements file, check boards concurrently (but at most one request per company), skip anything in `_seen`.
  If the monthly minutes run out, change the cron to every 60 min in one line.
- Serper budget: about 6 queries + up to about 6 company queries every 2h ≈ 150/day ≈ 4,500/month.
- OpenRouter: set a monthly cap on the key. Log the estimated cost per run in `Runs`.

## 9. Config (`config.yaml`)
```yaml
models:
  triage: "<cheap fast model from openrouter.ai/models>"
  scoring: "<stronger model from openrouter.ai/models>"
thresholds:
  green: 90
  yellow: 70
cadence:
  serper_every_n_runs: 4
search_queries: [...]   # §4.2
filtered_out_retention_days: 14
```

## 10. Milestones (stop after each and show the result)
1. **Scoring first.** Resume PDF → `resume.txt`. Implement P2 + match % + P3. Anupam pastes 3 real JDs
   (one strong fit, one medium, one poor). Pass when the three scores come out in the order he expects
   and every "reword" suggestion quotes a real resume line.
2. **Sheet.** Create tabs and headers, append a test row, prove that a hand-edited `Status` survives a second run.
3. **Companies.** Load `COMPANIES_SEED.md` into the Companies tab. For each company, detect its ATS and slug
   by probing the endpoints in §4.1. Report: how many resolved, how many are `other`.
4. **Job boards end to end.** §4.1 → title pre-filter → triage → scoring → Sheet. Run locally once.
5. **LinkedIn posts.** §4.2 + JD resolver. `--dry-run` first, so Anupam can eyeball 10 results.
6. **Remote boards + discovery.** §4.3 + §4.4.
7. **Schedule.** GitHub Actions workflow plus secrets. Watch 3 consecutive runs succeed in the `Runs` tab.
8. **Calibrate (week 1).** Check the success metric in §2 daily. Tune triage rules, queries and the profile — not the code.

## 11. Risks
| Risk | Mitigation |
|---|---|
| LinkedIn content behind login | Use only what Google shows. Never log in. Rows marked "snippet only". |
| LLM makes up gap evidence | "Reword" needs a verbatim resume quote, checked in code. |
| Inconsistent scores between runs | Match % is computed in code; keyword list cached per job. |
| Noisy "HR" matches (e.g. HR department jobs at random companies) | Triage checks what the *company builds*, not the word "HR". |
| GitHub minutes run out | Fast runs; fall back to every 60 min. |
| A board changes its API | Each source fails on its own; errors show up in `Runs`; the other sources keep going. |
