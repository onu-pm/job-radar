import { createHash } from "node:crypto";
import { config } from "./config";

export type Ats = "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters" | "recruitee";
export const ATS_LIST: Ats[] = ["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "recruitee"];

/** Source label shown on the site. */
export type SourceName =
  | Ats
  | "remoteok"
  | "remotive"
  | "weworkremotely"
  | "himalayas"
  | "jobicy"
  | "workingnomads"
  | "hackernews"
  | "linkedin_job";

/** One role as found by a source, before triage. */
export interface RawJob {
  source: SourceName;
  company: string;
  title: string;
  location: string | null;
  url: string; // the job page / apply link
  postedAt: Date; // known posting date (roles without one are never created)
  jdText: string; // full JD if the source has it, else a snippet
  jdFull: boolean;
  companyId?: number | null;
}

export function jobId(j: Pick<RawJob, "url">): string {
  return createHash("sha1").update(canonicalUrl(j.url)).digest("hex").slice(0, 16);
}

/** Same company + same title = same role across sources. */
export function dedupeKey(company: string, title: string): string {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${n(company)}|${n(title)}`;
}

export function canonicalUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|ref|source|gh_src|lever-source)/i.test(k)) url.searchParams.delete(k);
    return url.toString().replace(/\/$/, "");
  } catch {
    return u;
  }
}

const compiled = () => {
  const c = config().title_filter;
  return { inc: c.include.map((p) => new RegExp(p, "i")), exc: c.exclude.map((p) => new RegExp(p, "i")) };
};
let tf: ReturnType<typeof compiled> | null = null;

/** Code-level title pre-filter, before any LLM call. */
export function titlePasses(title: string): boolean {
  tf ??= compiled();
  return tf.inc.some((r) => r.test(title)) && !tf.exc.some((r) => r.test(title));
}

export function hoursAgo(d: Date, now = Date.now()): number {
  return (now - d.getTime()) / 3_600_000;
}

export function isFresh(d: Date | null | undefined, now = Date.now()): d is Date {
  if (!d || Number.isNaN(d.getTime())) return false;
  const h = hoursAgo(d, now);
  return h <= config().freshness_hours && h > -24; // ignore obviously bad future dates
}

/** Parses a date; date-only strings ("2026-10-12") count from 00:00 UTC that day (the cautious reading). */
export function parseDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);
  const s = String(v).trim();
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s.replace(/ UTC$/, "Z").replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}
