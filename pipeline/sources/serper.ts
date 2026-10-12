// Google results via Serper.dev. We only use what Google shows (title, link, snippet, date).
// LinkedIn and X pages are never fetched.
import { config, requireEnv } from "../config";
import { getJson } from "../http";

export interface SerperHit {
  title: string;
  link: string;
  snippet: string;
  date: string | null; // Google's own date text, e.g. "5 hours ago" or "Oct 11, 2026"
  query: string;
}

export let serperQueries = 0;

export async function serperSearch(q: string, opts: { tbs?: string; num?: number } = {}): Promise<SerperHit[]> {
  serperQueries++;
  const r = await getJson<{ organic?: any[] }>("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": requireEnv("SERPER_API_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify({ q, tbs: opts.tbs, num: opts.num ?? 10 }),
  });
  return (r.organic ?? []).map((o) => ({
    title: String(o.title ?? ""),
    link: String(o.link ?? ""),
    snippet: String(o.snippet ?? ""),
    date: o.date ? String(o.date) : null,
    query: q,
  }));
}

/** "5 hours ago" / "1 day ago" / "Oct 11, 2026" → Date. Unknown → null (and the item is dropped). */
export function parseGoogleDate(s: string | null, now = Date.now()): Date | null {
  if (!s) return null;
  const rel = s.match(/(\d+)\s*(minute|min|hour|hr|day|week)s?\s+ago/i);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const ms = unit.startsWith("min") ? 60e3 : unit.startsWith("h") ? 3600e3 : unit === "day" ? 86400e3 : 7 * 86400e3;
    return new Date(now - n * ms);
  }
  if (/^(yesterday)$/i.test(s.trim())) return new Date(now - 86400e3);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function linkedinJobHits(): Promise<SerperHit[]> {
  const c = config().serper;
  const out: SerperHit[] = [];
  for (const q of c.job_queries) out.push(...(await serperSearch(q, { tbs: c.tbs, num: c.results_per_query })));
  return out.filter((h) => /linkedin\.com\/jobs\/view\//.test(h.link));
}

export async function postHits(): Promise<SerperHit[]> {
  const c = config().serper;
  const out: SerperHit[] = [];
  for (const q of c.post_queries) out.push(...(await serperSearch(q, { tbs: c.tbs, num: c.results_per_query })));
  return out.filter((h) => /linkedin\.com\/posts\/|(?:x|twitter)\.com\/[^/]+\/status\//.test(h.link));
}

/** "Deel hiring Product Manager, Integrations in India | LinkedIn" → company, title, location. */
export function parseLinkedinJobTitle(t: string): { company: string | null; title: string; location: string | null } {
  const clean = t.replace(/\s*[|\-–]\s*LinkedIn\s*$/i, "").trim();
  const m = clean.match(/^(.+?) hiring (.+?)(?: in (.+))?$/i);
  if (m) return { company: m[1].trim(), title: m[2].trim(), location: m[3]?.trim() ?? null };
  const parts = clean.split(/\s+[-–|]\s+/);
  return { company: parts[1] ?? null, title: parts[0], location: parts[2] ?? null };
}
