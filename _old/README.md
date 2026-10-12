# Job Radar — start here

A personal script that finds mid-level PM roles at companies building for HR, scores each one
against your resume, and adds them to a Google Sheet every 30 minutes.

Not a website. Nobody else uses it. It runs on its own and fills your Sheet.

## What's in this folder

| File | What it is | Who reads it |
|---|---|---|
| `README.md` | This page | You |
| `SETUP.md` | The 4 accounts/keys you create once (about 30 min) | You |
| `CLAUDE.md` | Rules and build order for Claude Code | Claude Code |
| `PRD.md` | The full spec: sources, filters, scoring, Sheet layout | Claude Code (and you) |
| `PROMPTS.md` | The exact prompts sent to OpenRouter | Claude Code |
| `TARGET_PROFILE.md` | What counts as a match for you — edit this to change targeting | You + Claude Code |
| `COMPANIES_SEED.md` | Starting list of ~150 HR-tech companies (to be verified in the build) | Claude Code |
| `resume/` | The master resume every job is scored against | Claude Code |

## How to start

1. Do `SETUP.md` first (accounts + keys).
2. Open this folder in Claude Code.
3. Say: **"Read CLAUDE.md and PRD.md, then start Milestone 1. Stop after each milestone and show me the result."**
4. Don't skip Milestone 1. It tests the scoring on 3 real job descriptions before any sourcing gets built.
   If the scores look wrong there, everything after it will be wrong too.

## Running cost (estimates)

- Job boards (Greenhouse, Lever, Ashby…): free.
- Google search for LinkedIn posts (Serper): the first 2,500 searches are free, then $50 buys 50,000.
  At the planned pace (about 150 searches a day) that works out to roughly $4–5/month.
- OpenRouter: only *new* jobs get scored, so likely well under $1/day.
- GitHub Actions (the scheduler): free, if each run stays short (see PRD §8).
