// Server-side data loading for the site. Only the fields the browser needs leave the server
// (no full JD text, no resume text — just the short resume quotes behind each suggestion).
import "server-only";
import { config } from "@/pipeline/config";
import { db, must } from "./db";

export interface JobRow {
  id: string;
  company: string;
  title: string;
  source: string;
  url: string;
  location: string | null;
  postedAt: string;
  domain: "hr_tech" | "b2b_saas" | null;
  level: string | null;
  locationResult: string | null;
  locationEvidence: string | null;
  matchPct: number | null;
  jdFound: boolean;
  fit: number | null;
  why: string | null;
  fixGaps: { term: string; resume_quote: string; suggested_wording: string }[];
  realGaps: string[];
  matchedTerms: string[];
  scored: boolean;
  status: "new" | "applied" | "skip";
  hiringPostUrl: string | null;
}

export interface PostRow {
  id: string;
  platform: string;
  url: string;
  postedAt: string;
  personName: string | null;
  personHeadline: string | null;
  company: string | null;
  hiringFor: string | null;
  snippet: string | null;
  domain: string | null;
  matchedJobId: string | null;
  matchedJobTitle: string | null;
}

export interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  trigger: string;
  status: string;
  stage: string | null;
  sources: Record<string, { found: number; too_old: number; new: number; filtered: number; scored: number; errors: number }>;
  removed: { expired?: number; closed?: number; dead?: number };
  llm_calls: number;
  llm_cost_usd: number;
  serper_queries: number;
  errors: string[];
}

export async function loadDashboard() {
  const cfg = config();
  const cutoff = new Date(Date.now() - cfg.freshness_hours * 3600e3).toISOString();
  const [jobsR, statusR, postsR, runR, setR] = await Promise.all([
    db()
      .from("jobs")
      .select(
        "id,company,title,source,url,location,posted_at,domain,level,location_result,location_evidence,match_pct,jd_full,fit,why,fix_gaps,real_gaps,matched_terms,scored_at,hiring_post_id",
      )
      .eq("state", "active")
      .gte("posted_at", cutoff)
      .limit(2000),
    db().from("job_status").select("job_id,status"),
    db()
      .from("posts")
      .select("id,platform,url,posted_at,person_name,person_headline,company,hiring_for,snippet,domain,matched_job_id")
      .eq("state", "active")
      .gte("posted_at", cutoff)
      .order("posted_at", { ascending: false })
      .limit(500),
    db().from("runs").select("*").order("started_at", { ascending: false }).limit(1),
    db().from("settings").select("key,value"),
  ]);
  const jobsRaw = must<any[]>(jobsR, "jobs");
  const statuses = new Map(must<any[]>(statusR, "status").map((s) => [s.job_id, s.status]));
  const postsRaw = must<any[]>(postsR, "posts");
  const postUrl = new Map(postsRaw.map((p) => [p.id, p.url]));
  const jobTitle = new Map(jobsRaw.map((j) => [j.id, `${j.title} · ${j.company}`]));

  const jobs: JobRow[] = jobsRaw.map((j) => ({
    id: j.id,
    company: j.company,
    title: j.title,
    source: j.source,
    url: j.url,
    location: j.location,
    postedAt: j.posted_at,
    domain: j.domain,
    level: j.level,
    locationResult: j.location_result,
    locationEvidence: j.location_evidence,
    matchPct: j.match_pct,
    jdFound: j.jd_full,
    fit: j.fit,
    why: j.why,
    fixGaps: j.fix_gaps ?? [],
    realGaps: j.real_gaps ?? [],
    matchedTerms: j.matched_terms ?? [],
    scored: !!j.scored_at,
    status: statuses.get(j.id) ?? "new",
    hiringPostUrl: j.hiring_post_id ? (postUrl.get(j.hiring_post_id) ?? null) : null,
  }));

  const posts: PostRow[] = postsRaw.map((p) => ({
    id: p.id,
    platform: p.platform,
    url: p.url,
    postedAt: p.posted_at,
    personName: p.person_name,
    personHeadline: p.person_headline,
    company: p.company,
    hiringFor: p.hiring_for,
    snippet: p.snippet,
    domain: p.domain,
    matchedJobId: p.matched_job_id,
    matchedJobTitle: p.matched_job_id ? (jobTitle.get(p.matched_job_id) ?? null) : null,
  }));

  const settings = must<any[]>(setR, "settings");
  return {
    jobs,
    posts,
    lastRun: (must<RunRow[]>(runR, "runs")[0] ?? null) as RunRow | null,
    includeIndiaOnsite: settings.find((s) => s.key === "include_india_onsite")?.value === true,
    thresholds: cfg.thresholds,
    freshnessHours: cfg.freshness_hours,
  };
}

export async function loadRuns(limit = 30): Promise<RunRow[]> {
  return must<RunRow[]>(await db().from("runs").select("*").order("started_at", { ascending: false }).limit(limit), "runs");
}

export async function lastSuccessfulRun(): Promise<RunRow | null> {
  const r = must<RunRow[]>(
    await db().from("runs").select("*").eq("status", "success").order("started_at", { ascending: false }).limit(1),
    "runs",
  );
  return r[0] ?? null;
}
