# CLAUDE.md — instructions for Claude Code

## Who you're building for
Anupam (Poums) is a product manager, not an engineer.
- Explain each step in 1–2 plain lines: what and why.
- Make routine technical decisions yourself and log them in `DECISIONS.md`.
- Never ask him to paste keys into chat. Tell him how to put them in `.env`, Vercel env vars, or GitHub secrets.
- Don't add features beyond what he asked for. `_old/` is an earlier Google-Sheet design, kept for reference only.

## What this is
See `README.md`. Private website (Next.js on Vercel + Supabase) listing PM roles posted in the last 7 days, scored against
`resume/`, refreshed by a GitHub Actions pipeline (`pipeline/run.ts`).

## Hard rules
1. Never log into LinkedIn/X, use their cookies, or fetch their pages. Only Google results via Serper.
2. Only show roles with a known posting date inside `freshness_hours` (now 7 days). Re-check stored roles every run (age, 404, closed).
3. Match % is computed in code (`pipeline/scoring.ts`), never by the LLM. "Fix before applying" items must quote the resume
   verbatim — checked in code, else downgraded to real gap.
4. Every LLM call: temperature 0, strict JSON, validated, one retry, then skip that job. Never crash a run over one job.
5. Never re-score a job already in the database. Model names live in `config.yaml`, never in code.
6. Resume text stays server-side; the browser gets only the short quotes.
7. Secrets only from env vars. `.env` is git-ignored. The repo must stay private.
8. Be polite to job boards: one list request per board per run, timeouts, low concurrency.
