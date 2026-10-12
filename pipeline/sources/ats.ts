// Company job boards with public APIs that include posting dates.
// One list request per company board per run (+ a detail request only for fresh PM roles on
// SmartRecruiters, whose list endpoint has no description).
import { getJson, htmlToText, HttpError } from "../http";
import { type Ats, isFresh, parseDate, type RawJob, titlePasses } from "../types";

export interface BoardRef {
  companyId?: number | null;
  company: string;
  ats: Ats;
  slug: string;
}

export interface BoardResult {
  found: number; // all roles on the board
  jobs: RawJob[]; // fresh + PM-titled roles
  tooOld: number; // PM-titled but older than the freshness window
}

type Fetcher = (b: BoardRef) => Promise<BoardResult>;

const result = (found: number, pm: RawJob[], tooOld: number): BoardResult => ({ found, jobs: pm, tooOld });

/** Shared tail: keep PM titles, split fresh vs too old. */
function finish(found: number, candidates: (Omit<RawJob, "postedAt"> & { postedAt: Date | null })[]): BoardResult {
  const pm = candidates.filter((c) => titlePasses(c.title));
  const fresh = pm.filter((c): c is RawJob => isFresh(c.postedAt));
  return result(found, fresh, pm.length - fresh.length);
}

const greenhouse: Fetcher = async (b) => {
  const r = await getJson<{ jobs: any[] }>(`https://boards-api.greenhouse.io/v1/boards/${b.slug}/jobs?content=true`);
  return finish(
    r.jobs.length,
    r.jobs.map((j) => ({
      source: "greenhouse",
      company: b.company,
      companyId: b.companyId,
      title: j.title,
      location: j.location?.name ?? null,
      url: j.absolute_url,
      postedAt: parseDate(j.first_published),
      jdText: htmlToText(j.content),
      jdFull: true,
    })),
  );
};

const lever: Fetcher = async (b) => {
  const r = await getJson<any[]>(`https://api.lever.co/v0/postings/${b.slug}?mode=json`);
  return finish(
    r.length,
    r.map((j) => ({
      source: "lever",
      company: b.company,
      companyId: b.companyId,
      title: j.text,
      location: [j.categories?.location, j.workplaceType, j.country].filter(Boolean).join(" · ") || null,
      url: j.hostedUrl,
      postedAt: parseDate(j.createdAt),
      jdText: [
        j.openingPlain,
        j.descriptionBodyPlain ?? j.descriptionPlain,
        ...(j.lists ?? []).map((l: any) => `${l.text}\n${htmlToText(l.content)}`),
        j.additionalPlain,
      ]
        .filter(Boolean)
        .join("\n\n"),
      jdFull: true,
    })),
  );
};

const ashby: Fetcher = async (b) => {
  const r = await getJson<{ jobs: any[] }>(`https://api.ashbyhq.com/posting-api/job-board/${b.slug}?includeCompensation=true`);
  const jobs = r.jobs.filter((j) => j.isListed !== false);
  return finish(
    jobs.length,
    jobs.map((j) => ({
      source: "ashby",
      company: b.company,
      companyId: b.companyId,
      title: j.title,
      location:
        [j.location, ...(j.secondaryLocations ?? []).map((s: any) => s.location), j.isRemote ? "Remote" : null, j.workplaceType]
          .filter(Boolean)
          .join(" · ") || null,
      url: j.jobUrl,
      postedAt: parseDate(j.publishedAt),
      jdText: j.descriptionPlain ?? htmlToText(j.descriptionHtml),
      jdFull: true,
    })),
  );
};

const workable: Fetcher = async (b) => {
  const r = await getJson<{ jobs: any[] }>(`https://apply.workable.com/api/v1/widget/accounts/${b.slug}?details=true`);
  return finish(
    r.jobs.length,
    r.jobs.map((j) => ({
      source: "workable",
      company: b.company,
      companyId: b.companyId,
      title: j.title,
      location:
        [
          ...(j.locations ?? []).map((l: any) => [l.city, l.country].filter(Boolean).join(", ")),
          j.telecommuting ? "Remote" : null,
        ]
          .filter(Boolean)
          .join(" · ") || [j.city, j.country].filter(Boolean).join(", ") || null,
      url: j.url ?? j.shortlink,
      postedAt: parseDate(j.published_on ?? j.created_at), // date only → start of that day (UTC)
      jdText: htmlToText(j.description),
      jdFull: true,
    })),
  );
};

const smartrecruiters: Fetcher = async (b) => {
  const all: any[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const r = await getJson<{ content: any[]; totalFound: number }>(
      `https://api.smartrecruiters.com/v1/companies/${b.slug}/postings?limit=100&offset=${offset}`,
    );
    all.push(...r.content);
    if (all.length >= r.totalFound || r.content.length === 0) break;
  }
  const pmFresh = all.filter((j) => titlePasses(j.name) && isFresh(parseDate(j.releasedDate)));
  const tooOld = all.filter((j) => titlePasses(j.name)).length - pmFresh.length;
  const jobs: RawJob[] = [];
  for (const j of pmFresh) {
    const d = await getJson<any>(`https://api.smartrecruiters.com/v1/companies/${b.slug}/postings/${j.id}`).catch(() => null);
    const sections = d?.jobAd?.sections ?? {};
    const text = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"]
      .map((k) => (sections[k] ? `${sections[k].title ?? ""}\n${htmlToText(sections[k].text)}` : ""))
      .filter(Boolean)
      .join("\n\n");
    jobs.push({
      source: "smartrecruiters",
      company: b.company,
      companyId: b.companyId,
      title: j.name,
      location: [j.location?.fullLocation, j.location?.remote ? "Remote" : null, j.location?.hybrid ? "Hybrid" : null]
        .filter(Boolean)
        .join(" · "),
      url: d?.postingUrl ?? `https://jobs.smartrecruiters.com/${b.slug}/${j.id}`,
      postedAt: parseDate(j.releasedDate)!,
      jdText: text,
      jdFull: text.length > 300,
    });
  }
  return result(all.length, jobs, tooOld);
};

const recruitee: Fetcher = async (b) => {
  const r = await getJson<{ offers: any[] }>(`https://${b.slug}.recruitee.com/api/offers/`);
  const offers = r.offers.filter((o) => !o.status || o.status === "published");
  return finish(
    offers.length,
    offers.map((o) => ({
      source: "recruitee",
      company: b.company,
      companyId: b.companyId,
      title: o.title,
      location:
        [o.location, o.remote ? "Remote" : null, o.hybrid ? "Hybrid" : null, o.on_site ? "On-site" : null]
          .filter(Boolean)
          .join(" · ") || null,
      url: o.careers_url,
      postedAt: parseDate(o.published_at ?? o.created_at),
      jdText: [htmlToText(o.description), htmlToText(o.requirements)].filter(Boolean).join("\n\n"),
      jdFull: true,
    })),
  );
};

export const FETCHERS: Record<Ats, Fetcher> = { greenhouse, lever, ashby, workable, smartrecruiters, recruitee };

export function fetchBoard(b: BoardRef): Promise<BoardResult> {
  return FETCHERS[b.ats](b);
}

// ---- ATS + slug detection --------------------------------------------------------

/** Board-list URL used to probe whether a slug exists on an ATS (and has a public board). */
const PROBE: Record<Ats, (slug: string) => string> = {
  greenhouse: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
  lever: (s) => `https://api.lever.co/v0/postings/${s}?mode=json&limit=1`,
  ashby: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
  workable: (s) => `https://apply.workable.com/api/v1/widget/accounts/${s}`,
  smartrecruiters: (s) => `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=1`,
  recruitee: (s) => `https://${s}.recruitee.com/api/offers/`,
};

export interface ProbeHit {
  jobs: number;
  boardName: string | null; // company name as the ATS reports it, when it does
}

/** Returns the board's job count (and name if the ATS exposes it), or null if the slug isn't a board on that ATS. */
export async function probe(ats: Ats, slug: string): Promise<ProbeHit | null> {
  try {
    const r = await getJson<any>(PROBE[ats](slug));
    switch (ats) {
      case "greenhouse":
        return Array.isArray(r.jobs) ? { jobs: r.jobs.length, boardName: r.jobs[0]?.company_name ?? null } : null;
      case "lever":
        return Array.isArray(r) ? { jobs: r.length, boardName: null } : null;
      case "ashby":
        return Array.isArray(r.jobs) ? { jobs: r.jobs.length, boardName: null } : null;
      case "workable":
        return Array.isArray(r.jobs) && r.name ? { jobs: r.jobs.length, boardName: r.name } : null;
      case "smartrecruiters":
        // SmartRecruiters returns 200 + totalFound 0 for unknown companies, so 0 means "not found".
        return r.totalFound > 0 ? { jobs: r.totalFound, boardName: r.content?.[0]?.company?.name ?? null } : null;
      case "recruitee":
        return Array.isArray(r.offers) ? { jobs: r.offers.length, boardName: r.offers[0]?.company_name ?? null } : null;
    }
  } catch (e) {
    if (e instanceof HttpError) return null;
    return null;
  }
}

/** Slug guesses from a company name: "Papaya Global" → papayaglobal, papaya-global, papaya. */
export function slugCandidates(name: string, extra: string[] = []): string[] {
  const base = name
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim();
  const words = base.split(/\s+/).filter(Boolean);
  // No bare first-word guess ("papaya"): it too often hits a different company's board.
  const out = [...extra, words.join(""), words.join("-")];
  if (words.length > 1 && ["ai", "hq", "hr", "io", "app", "global", "inc"].includes(words.at(-1)!))
    out.push(words.slice(0, -1).join(""));
  return [...new Set(out.filter((s) => s && s.length >= 2))];
}
