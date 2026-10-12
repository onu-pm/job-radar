// JD resolver: for a role seen only on Google (LinkedIn job / hiring post), find the same role on the
// company's own ATS so we get the full JD and a real posting date.
import { type BoardRef, type BoardResult, fetchBoard } from "./sources/ats";
import { serperSearch } from "./sources/serper";
import { type Ats, type RawJob } from "./types";

/** URL on a supported ATS → ats + slug. */
export function parseAtsUrl(u: string): { ats: Ats; slug: string } | null {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return null;
  }
  const h = url.hostname;
  const seg = url.pathname.split("/").filter(Boolean);
  if (/(^|\.)greenhouse\.io$/.test(h) && seg[0] && seg[0] !== "embed") return { ats: "greenhouse", slug: seg[0] };
  if (h === "boards.greenhouse.io" && url.searchParams.get("for")) return { ats: "greenhouse", slug: url.searchParams.get("for")! };
  if (h === "jobs.lever.co" && seg[0]) return { ats: "lever", slug: seg[0] };
  if (h === "jobs.ashbyhq.com" && seg[0]) return { ats: "ashby", slug: seg[0] };
  if (h === "apply.workable.com" && seg[0] && seg[0] !== "api") return { ats: "workable", slug: seg[0] };
  if (h === "jobs.smartrecruiters.com" && seg[0]) return { ats: "smartrecruiters", slug: seg[0] };
  const rc = h.match(/^([a-z0-9-]+)\.recruitee\.com$/);
  if (rc) return { ats: "recruitee", slug: rc[1] };
  return null;
}

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !["the", "and", "for", "remote", "of"].includes(w)),
  );

/** Title similarity (0–1) on word overlap. */
export function titleSimilarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(A.size, B.size);
}

export function bestTitleMatch(title: string, jobs: RawJob[]): RawJob | null {
  let best: RawJob | null = null;
  let score = 0;
  for (const j of jobs) {
    const s = titleSimilarity(title, j.title);
    if (s > score) [best, score] = [j, s];
  }
  return score >= 0.6 ? best : null;
}

/** Board results fetched in this run, so a board is never requested twice. */
export class BoardCache {
  private cache = new Map<string, Promise<BoardResult | null>>();
  set(b: BoardRef, r: BoardResult) {
    this.cache.set(`${b.ats}:${b.slug}`, Promise.resolve(r));
  }
  get(b: BoardRef): Promise<BoardResult | null> {
    const k = `${b.ats}:${b.slug}`;
    if (!this.cache.has(k)) this.cache.set(k, fetchBoard(b).catch(() => null));
    return this.cache.get(k)!;
  }
}

const ATS_SITES =
  "(site:boards.greenhouse.io OR site:job-boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com OR site:apply.workable.com OR site:jobs.smartrecruiters.com OR site:recruitee.com)";

/**
 * Find the same role on an ATS. Order: (1) known company board, (2) an ATS link in the text,
 * (3) one Google search restricted to ATS sites. Returns null if not found.
 */
export async function resolveOnAts(args: {
  company: string | null;
  title: string;
  text: string;
  knownBoard: BoardRef | null;
  boards: BoardCache;
  allowSearch: boolean;
}): Promise<RawJob | null> {
  const tryBoard = async (b: BoardRef) => {
    const r = await args.boards.get(b);
    return r ? bestTitleMatch(args.title, r.jobs) : null;
  };
  if (args.knownBoard) {
    const hit = await tryBoard(args.knownBoard);
    if (hit) return hit;
  }
  for (const link of args.text.match(/https?:\/\/[^\s"'<>)]+/g) ?? []) {
    const p = parseAtsUrl(link);
    if (p) {
      const hit = await tryBoard({ ...p, company: args.company ?? p.slug });
      if (hit) return hit;
    }
  }
  if (args.allowSearch && args.company) {
    const hits = await serperSearch(`"${args.company}" "${args.title}" ${ATS_SITES}`, { num: 5 });
    for (const h of hits) {
      const p = parseAtsUrl(h.link);
      if (!p) continue;
      const hit = await tryBoard({ ...p, company: args.company });
      if (hit) return hit;
    }
  }
  return null;
}
