# Decisions log

Routine technical choices made during the build, newest last. Each: what, and why.

## Setup
1. **Old Google-Sheet spec moved to `_old/`.** The chat spec (website + Supabase) replaces it. `TARGET_PROFILE.md`
   stays at the root and was updated: remote-only by default, India hybrid/onsite only via the site toggle, HR tech vs B2B SaaS tags.
2. **TypeScript 5.9, not 7.0.** 7.0 is brand new; Next.js 16 is proven on 5.x.
3. **Next.js 16 "proxy" for the password gate.** Next 16 renamed middleware → `proxy.ts`. Same job.
4. **Resume text is cached in `resume/resume.txt`** and only re-extracted when the PDF is newer. Used by the pipeline only;
   the site never loads it. The browser only ever sees the short quotes behind each "Fix before applying" item.
5. **Env loading uses Node's built-in `process.loadEnvFile`** (no dotenv dependency).

## Scoring
6. **Keyword matching normalizes both sides the same way:** lowercase, every non-letter/number (including `/` and `-`) becomes a space.
   So "A/B testing" matches "A/B testing", "0-to-1" matches "0-to-1", and "HRIS/HRMS" counts as either term.
7. **A trailing plural is tolerated** ("integration" matches "integrations"). Still word-boundary, still deterministic.
8. **Quote check ignores case, whitespace, line breaks, curly quotes and the "●" bullet.** The PDF breaks lines mid-sentence;
   a real quote that spans a line break must still pass. Quotes shorter than 8 characters never count.
9. **If the gap model skips an unmatched keyword, it is treated as a real gap** (never silently dropped).
10. **Keywords are stored on the job row and reused**, so a job is never re-extracted or re-scored.
11. **Triage (Haiku) returns facts; pass/fail is decided in code** (`pipeline/triage.ts › decide`). "Unclear" level passes as mid;
    Senior with no years stated counts as too senior (spec: Senior only if ≤6 yrs).

## Sources & freshness
12. **Posting dates used:** Greenhouse `first_published`, Lever `createdAt`, Ashby `publishedAt`, Workable `published_on`,
    SmartRecruiters `releasedDate`, Recruitee `published_at`; remote boards' own publish dates; Google's own result date for
    LinkedIn/X. No date → never shown.
13. **Workable and Jobicy give dates without a time** (Workable) or vague ones; date-only values count from 00:00 UTC that day —
    the cautious reading of the 48h rule (a role may drop a few hours early, never show late).
14. **Workable widget API** (`/api/v1/widget/accounts/{slug}?details=true`) instead of the v3 POST endpoint: one request returns
    every job with its description.
15. **ATS detection ignores empty Workable boards.** Workable answers for dormant account names (it "found" Workday, Rippling,
    Zoho… all with 0 jobs). Empty boards on other ATSs count only if no board with jobs is found.
16. **No bare first-word slug guesses** ("papaya" for Papaya Global): too likely to hit another company's board.
17. **Seed: 193 HR-tech + 113 B2B SaaS companies; 140 resolved to a supported ATS, 166 are `other`.** Many Indian HRMS
    companies (Darwinbox, Keka, greytHR, Zoho…) run their own careers sites; they're covered only through the Google/LinkedIn
    searches. "Vanta HR" removed (duplicate of Vanta).
18. **Himalayas search is relevance-ordered, not by date**, so each run reads a fixed 10 pages (200 results) with a pause between
    pages and keeps only fresh roles. Jobicy/Working Nomads ignore their tag filters, so their latest listings are filtered in code.
19. **Remote boards all verified working on 2026-10-12:** RemoteOK, Remotive, We Work Remotely, Himalayas, Jobicy, Working Nomads,
    HN Who's Hiring. None dropped.
20. **Closed/removed detection:** a company-board role that disappears from its board's listing is marked closed (no extra request).
    Other roles get one GET of their link per run: 404/410 → dead; "no longer accepting applications" (and similar) → closed.
    LinkedIn/X/HN links are never fetched.
21. **Same role from two sources is stored once** (same URL, or same company + title). Company-board copies win, since they carry the full JD.
22. **LinkedIn job listings are matched to the company's own ATS** (known board → ATS link in the snippet → one Google search limited to
    ATS sites, max 10 per run). Unmatched ones are kept with the Google snippet, labelled "JD not found", match "—".
23. **Hiring posts are linked to a role by company name.**
24. **Serper: 10 results per search** (more costs 2 credits). Google's "past 48 hours" filter (`tbs=qdr:h48`).
25. **JSearch skipped for now.** Free tier is 100 requests/month; paid starts at $25/month, and it mostly duplicates roles already
    found via LinkedIn/ATS. Easy to add later as another source.

## Pipeline, data & site
26. **Supabase with Row Level Security on and no policies:** only the server (service-role key) can read/write. The browser never
    talks to Supabase.
27. **Your Applied/Skip status lives in its own table (`job_status`)**, so a refresh can never overwrite it.
28. **India hybrid/onsite toggle:** such roles are triaged and stored as filtered ("india_onsite"); switching the toggle on shows them
    immediately, and the next refresh scores any not yet scored. Switching off hides them again.
29. **Per-run caps:** 150 triage + 40 scoring calls. Overflow waits for the next run (it's still within 48h). Protects the budget.
30. **Rows older than 30 days are deleted** to stay inside Supabase's free tier.
31. **Schedule: every 3 hours at :17** (GitHub's top-of-hour queue is slowest). Runs never overlap (`concurrency`).
32. **"Refresh now" won't start a second run** if one started in the last 20 minutes.
33. **Schema is applied by `npm run db:migrate`** (Postgres connection string in `.env`), so no hand-pasting SQL.
