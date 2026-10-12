// One full refresh. Run locally with `npm run pipeline`, or by GitHub Actions (schedule / Refresh now).
// Each source fails on its own; one bad job never stops the run.
import { createHash } from "node:crypto";
import { db, must } from "../lib/db";
import { config, loadEnv } from "./config";
import { getText, pool } from "./http";
import { BudgetError, callsLeft, setCallBudget, usage } from "./llm";
import { BoardCache, resolveOnAts } from "./resolver";
import { loadResume } from "./resume";
import { scoreJob, type Keyword } from "./scoring";
import { fetchBoard, type BoardRef } from "./sources/ats";
import { REMOTE_SOURCES } from "./sources/remote";
import { linkedinJobHits, parseGoogleDate, parseLinkedinJobTitle, postHits, serperQueries } from "./sources/serper";
import { decide, triage, type Triage } from "./triage";
import { canonicalUrl, dedupeKey, isFresh, jobId, type Ats, type RawJob } from "./types";

loadEnv();
const cfg = config();
const now = Date.now();
const cutoffIso = new Date(now - cfg.freshness_hours * 3600e3).toISOString();

type Stat = { found: number; too_old: number; new: number; filtered: number; scored: number; errors: number };
const stats: Record<string, Stat> = {};
const stat = (s: string) => (stats[s] ??= { found: 0, too_old: 0, new: 0, filtered: 0, scored: 0, errors: 0 });
const errors: string[] = [];
const removed = { expired: 0, closed: 0, dead: 0 };

const runRow = must(
  await db().from("runs").insert({ trigger: process.env.RUN_TRIGGER ?? "local", stage: "Starting" }).select("id").single(),
  "create run",
) as { id: number };

async function stage(text: string) {
  console.log(`▸ ${text}`);
  await db().from("runs").update({ stage: text, sources: stats, removed, llm_calls: usage.calls, llm_cost_usd: usage.costUsd }).eq("id", runRow.id);
}

let budgetHit = false;
function logError(source: string, msg: string) {
  stat(source).errors++;
  errors.push(`${source}: ${msg}`.slice(0, 400));
  console.warn(`  ! ${source}: ${msg}`);
}

/** Supabase returns max 1000 rows per request; page through. */
async function selectAll<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const page = must<T[]>(await build().range(from, from + 999), "select");
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

const CLOSED_RE =
  /no longer accepting applications|job is no longer available|this job (has )?(expired|closed)|position (has been|is) (filled|closed)|no longer (open|available)|job not found|posting has been closed|this role has been filled/i;

try {
  const resumeText = await loadResume();
  const settings = must<{ key: string; value: any }[]>(await db().from("settings").select("key,value"), "settings");
  const includeIndiaOnsite = settings.find((s) => s.key === "include_india_onsite")?.value === true;

  // Daily LLM budget (free models are capped per day). "Today" = since 00:00 IST.
  const istMidnight = new Date(Math.floor((now + 5.5 * 3600e3) / 86400e3) * 86400e3 - 5.5 * 3600e3).toISOString();
  const today = must<{ llm_calls: number }[]>(
    await db().from("runs").select("llm_calls").gte("started_at", istMidnight).neq("id", runRow.id),
    "today's runs",
  );
  const usedToday = today.reduce((s, r) => s + (r.llm_calls ?? 0), 0);
  setCallBudget((cfg.limits.llm_calls_per_day ?? Infinity) - usedToday);
  console.log(`  LLM budget: ${usedToday} calls used today, ${callsLeft()} left`);

  // ---- 1. expire anything past the freshness window -------------------------------------------
  await stage("Removing roles older than 48h");
  const exp = must<{ id: string }[]>(
    await db().from("jobs").update({ state: "expired" }).in("state", ["pending", "active"]).lt("posted_at", cutoffIso).select("id"),
    "expire jobs",
  );
  removed.expired += exp.length;
  await db().from("posts").update({ state: "expired" }).in("state", ["pending", "active"]).lt("posted_at", cutoffIso);

  // ---- 2. company job boards ------------------------------------------------------------------
  const companies = must<{ id: number; name: string; ats: Ats | "other"; slug: string | null; domain: string }[]>(
    await db().from("companies").select("id,name,ats,slug,domain").eq("active", true),
    "companies",
  );
  const onAts = companies.filter((c) => c.ats !== "other" && c.slug);
  await stage(`Checking ${onAts.length} company job boards`);
  const boards = new BoardCache();
  const raw: RawJob[] = [];
  const openUrlsByCompany = new Map<number, Set<string>>();
  await pool(onAts, cfg.limits.ats_concurrency, async (c) => {
    const ref: BoardRef = { companyId: c.id, company: c.name, ats: c.ats as Ats, slug: c.slug! };
    try {
      const r = await fetchBoard(ref);
      boards.set(ref, r);
      const s = stat(c.ats);
      s.found += r.jobs.length + r.tooOld; // PM-titled roles on the board
      s.too_old += r.tooOld;
      raw.push(...r.jobs);
      openUrlsByCompany.set(c.id, new Set(r.jobs.map((j) => canonicalUrl(j.url))));
      await db().from("companies").update({ last_checked: new Date().toISOString(), jobs_on_board: r.found, last_error: null }).eq("id", c.id);
    } catch (e) {
      logError(c.ats, `${c.name}: ${(e as Error).message}`);
      await db().from("companies").update({ last_checked: new Date().toISOString(), last_error: (e as Error).message.slice(0, 200) }).eq("id", c.id);
    }
  });

  // ---- 3. remote boards -----------------------------------------------------------------------
  await stage("Checking remote job boards");
  for (const [name, fn] of Object.entries(REMOTE_SOURCES)) {
    try {
      const r = await fn();
      stat(name).found += r.jobs.length + r.tooOld;
      stat(name).too_old += r.tooOld;
      raw.push(...r.jobs);
    } catch (e) {
      logError(name, (e as Error).message);
    }
  }

  // ---- 4. Google (Serper): LinkedIn job listings ----------------------------------------------
  const serperOn = !!process.env.SERPER_API_KEY;
  const companyByName = new Map(companies.map((c) => [c.name.toLowerCase(), c]));
  if (serperOn) {
    await stage("Searching Google for LinkedIn job listings");
    try {
      const hits = await linkedinJobHits();
      let searches = 0;
      for (const h of hits) {
        const s = stat("linkedin_job");
        s.found++;
        const posted = parseGoogleDate(h.date);
        const p = parseLinkedinJobTitle(h.title);
        const known = p.company ? companyByName.get(p.company.toLowerCase()) : undefined;
        const ref = known && known.ats !== "other" && known.slug ? { companyId: known.id, company: known.name, ats: known.ats as Ats, slug: known.slug } : null;
        const onAts = await resolveOnAts({
          company: p.company,
          title: p.title,
          text: h.snippet,
          knownBoard: ref,
          boards,
          allowSearch: searches++ < 10,
        }).catch(() => null);
        if (onAts) {
          raw.push({ ...onAts, source: "linkedin_job" });
        } else if (isFresh(posted)) {
          raw.push({
            source: "linkedin_job",
            company: p.company ?? "Unknown",
            companyId: known?.id ?? null,
            title: p.title,
            location: p.location,
            url: h.link,
            postedAt: posted,
            jdText: `${h.title}\n${h.snippet}`,
            jdFull: false,
          });
        } else {
          s.too_old++; // no known posting date (or too old) → never shown
        }
      }
    } catch (e) {
      logError("linkedin_job", (e as Error).message);
    }
  }

  // ---- 5. store new roles (dedupe by URL and by company+title) ---------------------------------
  await stage("Saving new roles");
  const existing = await selectAll<{ id: string; dedupe_key: string }>(() =>
    db().from("jobs").select("id,dedupe_key").gte("first_seen", new Date(now - 14 * 86400e3).toISOString()),
  );
  const seenIds = new Set(existing.map((e) => e.id));
  const seenKeys = new Set(existing.map((e) => e.dedupe_key));
  // Company job boards first, so their full JD wins over a copy on a remote board.
  raw.sort((a, b) => Number(!!b.companyId) - Number(!!a.companyId));
  const fresh: any[] = [];
  for (const j of raw) {
    const id = jobId(j);
    const key = dedupeKey(j.company, j.title);
    if (seenIds.has(id) || seenKeys.has(key)) continue;
    seenIds.add(id);
    seenKeys.add(key);
    stat(j.source).new++;
    fresh.push({
      id,
      dedupe_key: key,
      source: j.source,
      company: j.company,
      company_id: j.companyId ?? null,
      title: j.title,
      location: j.location,
      url: j.url,
      posted_at: j.postedAt.toISOString(),
      jd_text: j.jdText.slice(0, 60000),
      jd_full: j.jdFull,
    });
  }
  for (let i = 0; i < fresh.length; i += 200) must(await db().from("jobs").insert(fresh.slice(i, i + 200)), "insert jobs");

  // ---- 6. re-check stored roles: closed on its board / 404 / "no longer accepting" -------------
  await stage("Re-checking stored roles are still open");
  const live = await selectAll<{ id: string; url: string; source: string; company_id: number | null }>(() =>
    db().from("jobs").select("id,url,source,company_id").in("state", ["pending", "active"]),
  );
  const closeIds: string[] = [];
  const deadIds: string[] = [];
  const toFetch: typeof live = [];
  for (const j of live) {
    const open = j.company_id != null ? openUrlsByCompany.get(j.company_id) : undefined;
    if (open && ["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "recruitee"].includes(j.source)) {
      if (!open.has(canonicalUrl(j.url))) closeIds.push(j.id); // gone from the company's own board
    } else if (!/linkedin\.com|x\.com|twitter\.com|news\.ycombinator\.com/.test(j.url)) {
      toFetch.push(j); // never fetch LinkedIn/X pages
    }
  }
  await pool(toFetch.slice(0, 120), 6, async (j) => {
    try {
      const r = await getText(j.url);
      if (r.status === 404 || r.status === 410) deadIds.push(j.id);
      else if (r.status === 200 && CLOSED_RE.test(r.text.slice(0, 200000))) closeIds.push(j.id);
    } catch {
      // network hiccup: leave it, re-check next run
    }
  });
  if (closeIds.length) must(await db().from("jobs").update({ state: "closed" }).in("id", closeIds), "close jobs");
  if (deadIds.length) must(await db().from("jobs").update({ state: "dead" }).in("id", deadIds), "dead jobs");
  removed.closed += closeIds.length;
  removed.dead += deadIds.length;
  const touched = live.map((j) => j.id).filter((id) => !closeIds.includes(id) && !deadIds.includes(id));
  for (let i = 0; i < touched.length; i += 300)
    await db().from("jobs").update({ last_checked: new Date().toISOString() }).in("id", touched.slice(i, i + 300));

  // ---- 7. India hybrid/onsite setting ----------------------------------------------------------
  if (includeIndiaOnsite) {
    await db().from("jobs").update({ state: "active", filter_reason: null }).eq("state", "filtered").eq("filter_reason", "india_onsite");
  } else {
    await db().from("jobs").update({ state: "filtered", filter_reason: "india_onsite" }).eq("state", "active").eq("location_result", "india_onsite");
  }

  // ---- 8. triage new roles (cheap model) -------------------------------------------------------
  // Keep roughly two-thirds of today's budget for scoring roles that pass.
  const triageCap = Math.min(cfg.limits.max_triage_per_run, Math.ceil(callsLeft() / 3));
  const pending = must<any[]>(
    await db().from("jobs").select("id,source,company,title,location,jd_text").eq("state", "pending").order("posted_at", { ascending: false }).limit(triageCap),
    "pending jobs",
  );
  await stage(`Triaging ${pending.length} new roles`);
  const llmPool = cfg.limits.llm_concurrency ?? 3;
  await pool(pending, llmPool, async (j) => {
    if (budgetHit) return;
    try {
      const t = await triage({
        source: j.source === "linkedin_job" ? "linkedin_job" : ["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "recruitee"].includes(j.source) ? "ats" : "remote_board",
        company: j.company,
        title: j.title,
        location: j.location,
        text: j.jd_text ?? "",
      });
      const d = decide(t, includeIndiaOnsite);
      if (!d.pass) stat(j.source).filtered++;
      const company = j.company === "Unknown" && t.company ? t.company : j.company;
      await db()
        .from("jobs")
        .update({
          state: d.pass ? "active" : "filtered",
          filter_reason: d.pass ? null : d.reason,
          triage: t,
          company,
          domain: t.domain === "other" ? null : t.domain,
          level: d.pass && d.stretch ? "stretch" : t.level,
          location_result: t.location_result,
          location_evidence: t.location_evidence,
        })
        .eq("id", j.id);
    } catch (e) {
      if (e instanceof BudgetError) budgetHit = true;
      else logError(j.source, `triage ${j.company} / ${j.title}: ${(e as Error).message}`);
    }
  });

  // ---- 9. score roles that passed (only once per job) ------------------------------------------
  const toScore = must<any[]>(
    await db()
      .from("jobs")
      .select("id,source,company,title,jd_text,jd_full,keywords,domain")
      .eq("state", "active")
      .is("scored_at", null)
      .order("domain", { ascending: false }) // hr_tech before b2b_saas
      .order("posted_at", { ascending: false })
      .limit(Math.min(cfg.limits.max_score_per_run, Math.floor(callsLeft() / 2))),
    "jobs to score",
  );
  await stage(`Scoring ${toScore.length} roles against the resume`);
  await pool(toScore, llmPool, async (j) => {
    if (budgetHit) return;
    try {
      const sc = await scoreJob({
        resumeText,
        company: j.company,
        roleTitle: j.title,
        jdText: j.jd_text ?? "",
        jdFound: j.jd_full,
        cachedKeywords: j.keywords as Keyword[] | null,
      });
      stat(j.source).scored++;
      await db()
        .from("jobs")
        .update({
          keywords: sc.keywords,
          match_pct: sc.matchPct,
          fit: sc.fit,
          why: sc.why,
          fix_gaps: sc.fix.map((g) => ({ term: g.term, resume_quote: g.resume_quote, suggested_wording: g.suggested_wording })),
          real_gaps: sc.realGaps,
          matched_terms: sc.matchedTerms,
          scored_at: new Date().toISOString(),
          score_error: null,
        })
        .eq("id", j.id);
    } catch (e) {
      if (e instanceof BudgetError) {
        budgetHit = true;
        return;
      }
      logError(j.source, `score ${j.company} / ${j.title}: ${(e as Error).message}`);
      await db().from("jobs").update({ score_error: (e as Error).message.slice(0, 300) }).eq("id", j.id);
    }
  });

  // ---- 10. hiring posts (LinkedIn / X via Google) ----------------------------------------------
  if (serperOn) {
    await stage("Searching Google for hiring posts");
    try {
      const hits = await postHits();
      const rows: any[] = [];
      const seen = new Set<string>();
      for (const h of hits) {
        const platform = /linkedin\.com/.test(h.link) ? "linkedin" : "x";
        const s = stat(`${platform}_post`);
        s.found++;
        const posted = parseGoogleDate(h.date);
        if (!isFresh(posted)) {
          s.too_old++;
          continue;
        }
        const id = createHash("sha1").update(canonicalUrl(h.link)).digest("hex").slice(0, 16);
        if (seen.has(id)) continue;
        seen.add(id);
        rows.push({ id, platform, url: h.link, posted_at: posted.toISOString(), snippet: `${h.title}\n${h.snippet}`.slice(0, 2000) });
      }
      if (rows.length) {
        const known = new Set(
          must<{ id: string }[]>(await db().from("posts").select("id").in("id", rows.map((r) => r.id)), "posts").map((r) => r.id),
        );
        const newRows = rows.filter((r) => !known.has(r.id));
        for (const r of newRows) stat(`${r.platform}_post`).new++;
        if (newRows.length) must(await db().from("posts").insert(newRows), "insert posts");
      }
    } catch (e) {
      logError("posts", (e as Error).message);
    }
  }

  const pendingPosts = budgetHit
    ? []
    : must<any[]>(await db().from("posts").select("id,platform,snippet").eq("state", "pending").order("posted_at", { ascending: false }).limit(Math.min(80, callsLeft())), "pending posts");
  if (pendingPosts.length) await stage(`Triaging ${pendingPosts.length} hiring posts`);
  await pool(pendingPosts, llmPool, async (p) => {
    if (budgetHit) return;
    try {
      const t: Triage = await triage({ source: p.platform === "x" ? "x_post" : "linkedin_post", text: p.snippet });
      const ok = t.is_hiring_post && t.is_pm_role && t.domain !== "other" && t.level !== "too_junior" && t.level !== "too_senior";
      if (!ok) stat(`${p.platform}_post`).filtered++;
      await db()
        .from("posts")
        .update({
          state: ok ? "active" : "filtered",
          filter_reason: ok ? null : !t.is_hiring_post ? "not a hiring post" : !t.is_pm_role ? "not a PM role" : t.domain === "other" ? "domain" : `level: ${t.level}`,
          triage: t,
          person_name: t.poster_name,
          person_headline: t.poster_headline,
          company: t.company,
          hiring_for: t.role_title,
          domain: t.domain === "other" ? null : t.domain,
        })
        .eq("id", p.id);
    } catch (e) {
      if (e instanceof BudgetError) budgetHit = true;
      else logError(`${p.platform}_post`, (e as Error).message);
    }
  });

  // Link posts ↔ roles by company name.
  const activePosts = must<{ id: string; company: string | null; matched_job_id: string | null }[]>(
    await db().from("posts").select("id,company,matched_job_id").eq("state", "active"),
    "active posts",
  );
  if (activePosts.length) {
    const activeJobs = await selectAll<{ id: string; company: string; title: string; hiring_post_id: string | null }>(() =>
      db().from("jobs").select("id,company,title,hiring_post_id").eq("state", "active"),
    );
    const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const p of activePosts) {
      if (!p.company) continue;
      const job = activeJobs.find((j) => norm(j.company) === norm(p.company));
      if (!job) continue;
      if (p.matched_job_id !== job.id) await db().from("posts").update({ matched_job_id: job.id }).eq("id", p.id);
      if (!job.hiring_post_id) {
        await db().from("jobs").update({ hiring_post_id: p.id }).eq("id", job.id);
        job.hiring_post_id = p.id;
      }
    }
  }

  // ---- 11. housekeeping: drop rows older than 30 days to stay inside the free tier ------------
  await db().from("jobs").delete().lt("posted_at", new Date(now - 30 * 86400e3).toISOString());
  await db().from("posts").delete().lt("posted_at", new Date(now - 30 * 86400e3).toISOString());

  await db()
    .from("runs")
    .update({
      status: "success",
      stage: "Done",
      finished_at: new Date().toISOString(),
      sources: stats,
      removed,
      llm_calls: usage.calls,
      llm_cost_usd: usage.costUsd,
      serper_queries: serperQueries,
      errors: budgetHit ? [...errors, "LLM daily budget reached — remaining roles wait for the next run"] : errors,
    })
    .eq("id", runRow.id);
  console.log("\nDone.", JSON.stringify({ stats, removed, llm: usage, serperQueries }, null, 1));
} catch (e) {
  console.error(e);
  errors.push(`fatal: ${(e as Error).message}`);
  await db()
    .from("runs")
    .update({ status: "failed", stage: "Failed", finished_at: new Date().toISOString(), sources: stats, removed, llm_calls: usage.calls, llm_cost_usd: usage.costUsd, serper_queries: serperQueries, errors })
    .eq("id", runRow.id);
  process.exitCode = 1;
}
