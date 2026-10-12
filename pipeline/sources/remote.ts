// Remote job boards (APIs/RSS). One request per board per run (Himalayas/HN: a few pages max).
import { XMLParser } from "fast-xml-parser";
import { getJson, getText, htmlToText } from "../http";
import { isFresh, parseDate, type RawJob, type SourceName, titlePasses } from "../types";
import { config } from "../config";

export interface SourceResult {
  found: number;
  jobs: RawJob[];
  tooOld: number;
}

type Cand = Omit<RawJob, "postedAt"> & { postedAt: Date | null };

function finish(found: number, cands: Cand[], titleCheck: (c: Cand) => boolean = (c) => titlePasses(c.title)): SourceResult {
  const seen = new Set<string>();
  const pm = cands.filter((c) => titleCheck(c) && c.url && !seen.has(c.url) && seen.add(c.url));
  const fresh = pm.filter((c): c is RawJob => isFresh(c.postedAt));
  return { found, jobs: fresh, tooOld: pm.length - fresh.length };
}

/** ISO strings without a timezone are UTC on these boards. */
const utc = (s: unknown) => (typeof s === "string" && /T\d\d:\d\d(:\d\d)?$/.test(s) ? parseDate(s + "Z") : parseDate(s));

async function remoteok(): Promise<SourceResult> {
  const r = await getJson<any[]>("https://remoteok.com/api");
  const jobs = r.filter((j) => j && j.position);
  return finish(
    jobs.length,
    jobs.map((j) => ({
      source: "remoteok",
      company: j.company,
      title: j.position,
      location: j.location || "Remote",
      url: j.url ?? j.apply_url,
      postedAt: parseDate(j.epoch ?? j.date),
      jdText: htmlToText(j.description),
      jdFull: true,
    })),
  );
}

async function remotive(): Promise<SourceResult> {
  const r = await getJson<{ jobs: any[] }>("https://remotive.com/api/remote-jobs?category=product");
  return finish(
    r.jobs.length,
    r.jobs.map((j) => ({
      source: "remotive",
      company: j.company_name,
      title: j.title,
      location: `Remote · ${j.candidate_required_location ?? "?"}`,
      url: j.url,
      postedAt: utc(j.publication_date),
      jdText: htmlToText(j.description),
      jdFull: true,
    })),
  );
}

async function weworkremotely(): Promise<SourceResult> {
  const { text } = await getText("https://weworkremotely.com/categories/remote-product-jobs.rss");
  const items: any[] = [].concat(new XMLParser().parse(text)?.rss?.channel?.item ?? []);
  return finish(
    items.length,
    items.map((i) => {
      const [company, ...rest] = String(i.title).split(":");
      return {
        source: "weworkremotely" as SourceName,
        company: company.trim(),
        title: rest.join(":").trim() || String(i.title),
        location: `Remote · ${i.region ?? ""}${i.country ? ` · ${i.country}` : ""}`,
        url: i.link,
        postedAt: parseDate(i.pubDate),
        jdText: htmlToText(i.description),
        jdFull: true,
      };
    }),
  );
}

async function himalayas(): Promise<SourceResult> {
  const cands: Cand[] = [];
  let found = 0;
  // Search is relevance-ordered (not by date), so read a fixed 10 pages and keep the fresh ones.
  for (let page = 1; page <= 10; page++) {
    if (page > 1) await new Promise((r) => setTimeout(r, 600));
    const r = await getJson<{ jobs: any[] }>(`https://himalayas.app/jobs/api/search?q=product+manager&page=${page}`);
    const jobs = r.jobs ?? [];
    found += jobs.length;
    for (const j of jobs)
      cands.push({
        source: "himalayas",
        company: j.companyName,
        title: j.title,
        location: `Remote · ${(j.locationRestrictions ?? []).join(", ") || "Worldwide"}${
          j.timezoneRestrictions?.length ? ` · UTC${j.timezoneRestrictions.map((t: number) => (t >= 0 ? `+${t}` : t)).join("/")}` : ""
        }`,
        url: j.applicationLink ?? j.guid,
        postedAt: parseDate(j.pubDate),
        jdText: htmlToText(j.description),
        jdFull: true,
      });
    if (jobs.length === 0) break;
  }
  return finish(found, cands);
}

async function jobicy(): Promise<SourceResult> {
  const r = await getJson<{ jobs: any[] }>("https://jobicy.com/api/v2/remote-jobs?count=100");
  const jobs = r.jobs ?? [];
  return finish(
    jobs.length,
    jobs.map((j) => ({
      source: "jobicy",
      company: j.companyName,
      title: htmlToText(j.jobTitle),
      location: `Remote · ${j.jobGeo ?? "?"}`,
      url: j.url,
      postedAt: parseDate(j.pubDate),
      jdText: htmlToText(j.jobDescription),
      jdFull: true,
    })),
  );
}

async function workingnomads(): Promise<SourceResult> {
  const r = await getJson<any[]>("https://www.workingnomads.com/api/exposed_jobs/");
  return finish(
    r.length,
    r.map((j) => ({
      source: "workingnomads",
      company: j.company_name,
      title: j.title,
      location: `Remote · ${j.location || "?"}`,
      url: j.url,
      postedAt: parseDate(j.pub_date),
      jdText: htmlToText(j.description),
      jdFull: true,
    })),
  );
}

/** HN "Who is hiring?" — newest monthly thread; only comments from the freshness window. */
async function hackernews(): Promise<SourceResult> {
  const s = await getJson<{ hits: any[] }>(
    "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5",
  );
  const thread = s.hits.find((h) => /who is hiring/i.test(h.title));
  if (!thread) return { found: 0, jobs: [], tooOld: 0 };
  const since = Math.floor(Date.now() / 1000 - config().freshness_hours * 3600);
  const c = await getJson<{ hits: any[] }>(
    `https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_${thread.objectID}&numericFilters=created_at_i>${since}&hitsPerPage=1000`,
  );
  const top = c.hits.filter((h) => String(h.parent_id) === String(thread.objectID));
  const cands: Cand[] = top.map((h) => {
    const text = htmlToText(h.comment_text);
    const first = text.split("\n")[0].slice(0, 200);
    return {
      source: "hackernews",
      company: first.split("|")[0].trim().slice(0, 80),
      title: first,
      location: first.split("|").slice(1).join("|").trim() || null,
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      postedAt: parseDate(h.created_at),
      jdText: text,
      jdFull: text.length > 600,
    };
  });
  // HN posts list several roles; look for a PM role anywhere in the post.
  return finish(c.hits.length, cands, (x) => /product (manager|owner)/i.test(x.jdText) && !/product marketing manager/i.test(x.title));
}

export const REMOTE_SOURCES: Record<string, () => Promise<SourceResult>> = {
  remoteok,
  remotive,
  weworkremotely,
  himalayas,
  jobicy,
  workingnomads,
  hackernews,
};
