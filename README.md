# Job Radar

A private, password-protected website that lists Product Manager roles posted in the **last 48 hours**,
scores each one against the master resume, and shows what to reword before applying. A second tab lists
recent LinkedIn/X posts from people hiring PMs in HR tech and B2B SaaS.

- **Site:** Next.js on Vercel, behind one password, `noindex`.
- **Data:** Supabase (Postgres, free tier).
- **Refresh:** a TypeScript pipeline run by GitHub Actions every 3 hours, or by "Refresh now" on the site.
- **AI:** OpenRouter (`config.yaml` → models). Match % is computed in code, never by the AI.

## Where things are
| Path | What |
|---|---|
| `config.yaml` | Models, prices, 48h window, thresholds, title filters, Google queries |
| `TARGET_PROFILE.md` | What counts as a match — sent to the AI with every role. Edit freely. |
| `resume/` | Master resume PDF (+ cached `resume.txt`) |
| `pipeline/` | The refresh: sources, triage, scoring, JD resolver (`run.ts` is one full pass) |
| `app/`, `components/` | The website |
| `supabase/schema.sql` | Database tables |
| `DECISIONS.md` | Technical decisions and why |

## Commands
```bash
npm run score -- test-jds/1-strong-check.txt   # scorecard for one JD (needs OPENROUTER_API_KEY)
npm run dry-run                                 # what the remote boards return right now (no keys)
npm run dry-run -- ats greenhouse gusto Gusto   # one company board
npm run detect-ats                              # (re)detect company job boards → data/companies.json
npm run db:migrate                              # create tables + load companies (needs SUPABASE_DB_URL)
npm run pipeline                                # one full refresh, locally
npm run dev                                     # site on http://localhost:3000
```

## Adding a company
Add a row in Supabase → Table Editor → `companies` (name, domain `hr_tech`/`b2b_saas`, ats, slug, `added_by = manual`).
If you don't know the ATS, add it to `pipeline/seed/companies.ts` and run `npm run detect-ats` then `npm run db:migrate`.
