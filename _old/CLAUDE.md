# CLAUDE.md — instructions for Claude Code

## Who you're building for
Anupam (Poums) is a product manager, not an engineer. He uses Claude Code to build.
- Explain every step in plain language: what you're doing and why, in 1–2 lines.
- Build one milestone at a time (PRD §10). At the end of each milestone, **stop**, show what works
  (real output, not a description), and wait for his go-ahead.
- When he has to do something by hand (create a key, share a Sheet, add a GitHub secret),
  give click-by-click steps.
- Don't add features that aren't in PRD.md. If something seems missing, ask.

## What this is
A personal job-alert pipeline (not a website). It finds mid-level PM roles at companies building
for HR and HR teams, filters them by level and location, scores each against his resume, and adds
rows to a Google Sheet. It runs every 30 minutes on GitHub Actions. Full spec: `PRD.md`.

## Stack (fixed; don't swap without asking)
- Python 3.11+, plain scripts. No web framework, no frontend, no database server.
- `httpx` for HTTP, `gspread` + a Google service account for Sheets, `pypdf` for reading the resume,
  `pyyaml` for config, `python-dotenv` for local secrets.
- LLM calls go through **OpenRouter** (OpenAI-compatible endpoint `https://openrouter.ai/api/v1`).
  Model names live in `config.yaml`, never in code.
- Search: **Serper.dev** (Google results API).
- Scheduler: **GitHub Actions** cron, every 30 minutes.
- State/dedupe: stored **in the Google Sheet** (a hidden `_seen` tab), because GitHub Actions runners
  start fresh every time and a local file would be lost between runs.

## Hard rules
1. **Never log into LinkedIn or use LinkedIn cookies/sessions.** LinkedIn posts are found only through
   Google results (Serper). If a LinkedIn page can't be read without logging in, use only the Google
   snippet and mark the row `JD: not found`.
2. Secrets only from env vars (`.env` locally, GitHub Secrets in CI). `.env` and any `*.json` key
   files go in `.gitignore` from the first commit.
3. **Never overwrite or reorder existing Sheet rows.** Only append. Anupam edits `Status` and `Notes`
   by hand, and those edits must survive every run.
4. The keyword match % must be **computed in code**, never asked of the LLM (PRD §6). The LLM only
   extracts keywords and classifies gaps.
5. Every LLM call returns strict JSON that gets validated. On a parse failure, retry once, then log
   the error and skip the job. Never crash the whole run over one job.
6. Be polite to job boards: one request per company board per run, timeouts, no parallel hammering.
7. Keep a run under ~1 minute when there's nothing new (GitHub free-minutes budget, PRD §8).
   Score only jobs that aren't in `_seen` yet.

## Project layout (target)
```
job-radar/
  config.yaml          # models, thresholds, cadence, search queries
  TARGET_PROFILE.md    # what counts as a match (Anupam edits this)
  resume/              # master resume PDF
  src/
    resume.py          # PDF → clean text (cached as resume.txt)
    sources/
      ats.py           # Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Personio
      linkedin_posts.py# Serper search → candidate posts
      remote_boards.py # RemoteOK, Remotive, WeWorkRemotely RSS, HN Who's Hiring
    jd_resolver.py     # follow apply links to fetch the full JD text
    triage.py          # cheap-model filter (PRD §5)
    scoring.py         # keyword extraction + match % + gaps + fit (PRD §6)
    sheet.py           # read Companies/_seen, append Matches/Filtered out
    run.py             # one full pass
  .github/workflows/radar.yml
```

## Testing
- Each source module gets a `--dry-run` that prints what it found without writing to the Sheet.
- `scoring.py` gets a CLI: `python -m src.scoring path/to/jd.txt` prints the full scorecard.
  That's Milestone 1's acceptance test.
