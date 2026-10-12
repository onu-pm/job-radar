// npm run hr-remote-india — which HR-tech companies (worldwide) have a role open right now that is
// remote AND open to India? Writes data/hr-tech-remote-india.csv + .md and pipeline/seed/discovered.ts.
//
// Candidates: HR-tech companies in data/companies.json that are on a supported ATS, plus new boards found
// by Google (Serper) searches of ATS sites. No LLM calls: India/remote is read from each role's location
// fields, and new companies must show HR-product wording in their own job descriptions.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnv } from "../config";
import { getJson, htmlToText, pool } from "../http";
import { parseAtsUrl } from "../resolver";
import { serperSearch } from "../sources/serper";
import type { Ats } from "../types";

loadEnv();

interface Role {
  title: string;
  location: string;
  remote: boolean;
  url: string;
  text: string;
}
interface Board {
  name: string;
  category: string;
  ats: Ats;
  slug: string;
  origin: "seed" | "discovered";
}

const INDIA = /\b(india|indian|bengaluru|bangalore|mumbai|delhi|new delhi|gurgaon|gurugram|noida|hyderabad|pune|chennai|kolkata|ahmedabad|kochi|jaipur|ist)\b/i;
const WIDE = /\b(anywhere|worldwide|global(ly)?|apac|asia|asia[- ]pacific|any location|work from anywhere|all locations)\b/i;
const REMOTE = /\b(remote|distributed|work from home|wfh|anywhere)\b/i;
const PM = /\bproduct (manager|owner)\b/i;

const boardUrl: Record<Ats, (s: string) => string> = {
  greenhouse: (s) => `https://job-boards.greenhouse.io/${s}`,
  lever: (s) => `https://jobs.lever.co/${s}`,
  ashby: (s) => `https://jobs.ashbyhq.com/${s}`,
  workable: (s) => `https://apply.workable.com/${s}`,
  smartrecruiters: (s) => `https://jobs.smartrecruiters.com/${s}`,
  recruitee: (s) => `https://${s}.recruitee.com`,
};

/** Every open role on a board with its location fields (one request per board). */
async function listRoles(ats: Ats, slug: string): Promise<{ roles: Role[]; boardName: string | null }> {
  switch (ats) {
    case "greenhouse": {
      const r = await getJson<any>(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
      return {
        boardName: r.jobs[0]?.company_name ?? null,
        roles: r.jobs.map((j: any) => {
          const loc = [j.location?.name, ...(j.offices ?? []).map((o: any) => o.name)].filter(Boolean).join(" · ");
          return { title: j.title, location: loc, remote: REMOTE.test(loc), url: j.absolute_url, text: htmlToText(j.content).slice(0, 2500) };
        }),
      };
    }
    case "lever": {
      const r = await getJson<any[]>(`https://api.lever.co/v0/postings/${slug}?mode=json`);
      return {
        boardName: null,
        roles: r.map((j) => {
          const loc = [...(j.categories?.allLocations ?? [j.categories?.location]), j.country].filter(Boolean).join(" · ");
          return { title: j.text, location: loc, remote: j.workplaceType === "remote" || REMOTE.test(loc), url: j.hostedUrl, text: String(j.openingPlain ?? j.descriptionPlain ?? "").slice(0, 2500) };
        }),
      };
    }
    case "ashby": {
      const r = await getJson<any>(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
      return {
        boardName: null,
        roles: (r.jobs ?? []).filter((j: any) => j.isListed !== false).map((j: any) => {
          const loc = [j.location, ...(j.secondaryLocations ?? []).map((s: any) => s.location), j.address?.postalAddress?.addressCountry].filter(Boolean).join(" · ");
          return { title: j.title, location: loc, remote: j.isRemote === true || j.workplaceType === "Remote" || REMOTE.test(loc), url: j.jobUrl, text: String(j.descriptionPlain ?? "").slice(0, 2500) };
        }),
      };
    }
    case "workable": {
      const r = await getJson<any>(`https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`);
      return {
        boardName: r.name ?? null,
        roles: (r.jobs ?? []).map((j: any) => {
          const loc = [...(j.locations ?? []).map((l: any) => [l.city, l.country].filter(Boolean).join(", ")), j.country].filter(Boolean).join(" · ");
          return { title: j.title, location: loc, remote: j.telecommuting === true || REMOTE.test(loc), url: j.url ?? j.shortlink, text: htmlToText(j.description).slice(0, 2500) };
        }),
      };
    }
    case "smartrecruiters": {
      const r = await getJson<any>(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`);
      return {
        boardName: r.content?.[0]?.company?.name ?? null,
        roles: (r.content ?? []).map((j: any) => {
          const loc = [j.location?.fullLocation, j.location?.country === "in" ? "India" : null].filter(Boolean).join(" · ");
          return { title: j.name, location: loc, remote: j.location?.remote === true || REMOTE.test(loc), url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`, text: "" };
        }),
      };
    }
    case "recruitee": {
      const r = await getJson<any>(`https://${slug}.recruitee.com/api/offers/`);
      return {
        boardName: r.offers?.[0]?.company_name ?? null,
        roles: (r.offers ?? []).map((o: any) => {
          const loc = [o.location, o.country].filter(Boolean).join(" · ");
          return { title: o.title, location: loc, remote: o.remote === true || REMOTE.test(loc), url: o.careers_url, text: htmlToText(o.description).slice(0, 2500) };
        }),
      };
    }
  }
}

/** Remote with no region at all ("Remote", "Remote · Remote"): may or may not include India. */
function remoteNoRegion(r: Role): boolean {
  return r.remote && r.location.replace(/remote|·|,|-|\(|\)|\s/gi, "") === "";
}

/** Remote AND open to India: India / an Indian city / IST, or worldwide / APAC / Asia. */
function openToIndia(r: Role): "india" | "wide" | null {
  if (!r.remote) return null;
  if (INDIA.test(r.location)) return "india";
  if (WIDE.test(r.location)) return "wide";
  return null;
}

// HR-product wording a company's own JDs use when it builds for HR teams.
const HR_TERMS = [
  /\bhris\b/i, /\bhrms\b/i, /\bhcm\b/i, /\bpayroll\b/i, /human resources/i, /\bhr (teams?|leaders|software|platform|tech)\b/i,
  /people (teams?|operations|platform)/i, /\bworkforce\b/i, /employee experience/i, /\bbenefits (platform|administration)\b/i,
  /recruit(ing|ers|ment) (software|platform|teams?)/i, /talent acquisition/i, /applicant tracking/i, /hiring (platform|teams)/i,
  /global employment/i, /employer of record|\beor\b/i, /\bonboarding\b/i, /performance management/i, /employee engagement/i,
  /\bcompensation\b/i, /background (checks?|screening)/i, /earned wage/i, /\bpeople ops\b/i,
];
const AGENCY = /\b(staffing|recruitment agency|our client|on behalf of (our|a) client|talent network)\b/i;

function hrScore(roles: Role[]): number {
  const text = roles.slice(0, 5).map((r) => r.text.slice(0, 1500)).join("\n");
  if (AGENCY.test(text)) return 0;
  return HR_TERMS.filter((t) => t.test(text)).length;
}

// ---- 1. candidates ------------------------------------------------------------------------------
const companies: any[] = JSON.parse(readFileSync("data/companies.json", "utf8"));
const boards: Board[] = companies
  .filter((c) => c.domain === "hr_tech" && c.ats !== "other" && c.slug && c.jobs_on_board !== 0)
  .map((c) => ({ name: c.name, category: c.category, ats: c.ats, slug: c.slug, origin: "seed" }));
const known = new Set(boards.map((b) => `${b.ats}:${b.slug.toLowerCase()}`));
const knownSlugs = new Set(companies.filter((c) => c.slug).map((c) => `${c.ats}:${String(c.slug).toLowerCase()}`));

const THEMES: [string, string][] = [
  ['(HRIS OR HRMS OR HCM OR "HR software" OR "people platform")', "HRIS / HRMS / HCM"],
  ['(payroll OR EOR OR "employer of record" OR "global employment")', "Payroll, EOR & global employment"],
  ['("applicant tracking" OR "recruiting software" OR "talent acquisition platform" OR "hiring platform")', "Recruiting / ATS / talent"],
  ['("employee engagement" OR "performance management" OR "employee benefits" OR "workforce management")', "Performance, engagement & benefits"],
];
const SITES = ["jobs.ashbyhq.com", "job-boards.greenhouse.io", "jobs.lever.co", "apply.workable.com", "jobs.smartrecruiters.com"];
const discoveredCat = new Map<string, string>();
if (process.env.SERPER_API_KEY && !process.argv.includes("--no-search")) {
  console.log(`Searching Google: ${THEMES.length * SITES.length} queries…`);
  for (const [theme, cat] of THEMES)
    for (const site of SITES) {
      try {
        for (const h of await serperSearch(`site:${site} ${theme} remote India`, { tbs: "qdr:m", num: 10 })) {
          const p = parseAtsUrl(h.link);
          if (!p) continue;
          const k = `${p.ats}:${p.slug.toLowerCase()}`;
          if (!knownSlugs.has(k) && !discoveredCat.has(k)) discoveredCat.set(k, cat);
        }
      } catch (e) {
        console.warn("  search failed:", (e as Error).message);
      }
    }
  for (const [k, cat] of discoveredCat) {
    const [ats, slug] = k.split(":");
    boards.push({ name: slug, category: cat, ats: ats as Ats, slug, origin: "discovered" });
  }
  console.log(`  ${discoveredCat.size} new boards found`);
}

// ---- 2. read every board once ---------------------------------------------------------------------
console.log(`Reading ${boards.length} job boards…`);
type Row = Board & { india: Role[]; wide: Role[]; pm: Role[]; office: Role[]; unclear: Role[]; total: number; hr: number };
const rows: Row[] = [];
await pool(boards, 6, async (b) => {
  try {
    const { roles, boardName } = await listRoles(b.ats, b.slug);
    if (b.origin === "discovered" && boardName) b.name = boardName;
    const india = roles.filter((r) => openToIndia(r) === "india");
    const wide = roles.filter((r) => openToIndia(r) === "wide");
    const open = [...india, ...wide];
    const office = roles.filter((r) => !r.remote && INDIA.test(r.location));
    const unclear = roles.filter(remoteNoRegion);
    rows.push({ ...b, india, wide, office, unclear, pm: [...open, ...office].filter((r) => PM.test(r.title)), total: roles.length, hr: b.origin === "seed" ? 99 : hrScore(roles) });
  } catch {
    // board gone or blocked: skip
  }
});

// Discovered boards must look like HR tech from their own JDs (≥3 distinct HR-product terms).
const isHr = (r: Row) => r.origin === "seed" || r.hr >= 3;
const tidy = (r: Row) => (r.origin === "discovered" ? { ...r, name: r.name.replace(/(^|[-_ ])\w/g, (m) => m.toUpperCase()).replace(/[-_]/g, " ") } : r);
const byOpen = (a: Row, b: Row) => b.pm.length - a.pm.length || b.india.length + b.wide.length - (a.india.length + a.wide.length);
const hits = rows.filter((r) => r.india.length + r.wide.length > 0).filter(isHr).map(tidy).sort(byOpen);
const tier2 = rows.filter((r) => r.india.length + r.wide.length === 0 && r.office.length > 0).filter(isHr).map(tidy)
  .sort((a, b) => b.pm.length - a.pm.length || b.office.length - a.office.length);
const tier3 = rows.filter((r) => r.india.length + r.wide.length + r.office.length === 0 && r.unclear.length > 0).filter(isHr).map(tidy)
  .sort((a, b) => b.unclear.length - a.unclear.length);
const rejected = rows.filter((r) => r.origin === "discovered" && r.india.length + r.wide.length + r.office.length > 0 && r.hr < 3);
const ownSite = companies.filter((c) => c.domain === "hr_tech" && (c.ats === "other" || c.jobs_on_board === 0)).map((c) => c.name);

// ---- 3. outputs ---------------------------------------------------------------------------------------
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const csvCell = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
const example = (r: Role) => `${r.title} — ${r.location} — ${r.url}`;
const csv = [
  ["Tier", "Company", "Category", "Found via", "ATS", "Careers board", "Remote roles open to India", "India office/hybrid roles", "Remote, region not stated", "PM roles (India-open or India office)", "Example roles (title — location — link)", "Checked (IST)"],
  ...[...hits.map((r) => ["1 · Remote, open to India", r] as const), ...tier2.map((r) => ["2 · India office/hybrid", r] as const), ...tier3.map((r) => ["3 · Remote, region not stated", r] as const)].map(([tier, r]) => [
    tier, r.name, r.category, r.origin === "seed" ? "seed list" : "Google search", r.ats, boardUrl[r.ats](r.slug),
    String(r.india.length + r.wide.length), String(r.office.length), String(r.unclear.length), String(r.pm.length),
    [...r.pm, ...r.india, ...r.wide, ...r.office, ...r.unclear].filter((x, i, a) => a.indexOf(x) === i).slice(0, 3).map(example).join("\n"), today,
  ]),
  ...ownSite.map((n) => ["4 · Own careers site (not checked)", n, companies.find((c) => c.name === n)?.category ?? "", "seed list", "other", "", "", "", "", "", "", today]),
].map((row) => row.map(csvCell).join(",")).join("\n");
writeFileSync("data/hr-tech-remote-india.csv", csv + "\n");

const mdRow = (r: Row, n: number, pool: Role[]) => {
  const ex = [...r.pm, ...pool][0];
  return `| [${r.name}](${boardUrl[r.ats](r.slug)}) | ${r.category} | ${n} | ${r.pm.length || ""} | [${ex.title.replace(/\|/g, "/")}](${ex.url}) |`;
};
const head = "| Company | Category | Roles | PM roles | Example |\n|---|---|---|---|---|";
const md = [
  `# HR-tech companies hiring from India — ${today}`,
  "",
  `Checked ${rows.length} job boards. Full list with up to 3 example links each: \`data/hr-tech-remote-india.csv\`.`,
  "",
  `## Tier 1 · Remote and open to India (${hits.length})`,
  "A current role says remote AND India / an Indian city, or worldwide / APAC / Asia.",
  "",
  head,
  ...hits.map((r) => mdRow(r, r.india.length + r.wide.length, [...r.india, ...r.wide])),
  "",
  `## Tier 2 · Hiring in India, office or hybrid (${tier2.length})`,
  "No remote-India role right now, but open roles based in India.",
  "",
  head,
  ...tier2.map((r) => mdRow(r, r.office.length, r.office)),
  "",
  `## Tier 3 · Remote, region not stated (${tier3.length})`,
  "Roles just say \"Remote\". Worth checking whether India is allowed.",
  "",
  head,
  ...tier3.map((r) => mdRow(r, r.unclear.length, r.unclear)),
  "",
  `## Tier 4 · HR tech on their own careers site — not checked automatically (${ownSite.length})`,
  ownSite.join(", "),
  "",
  rejected.length ? `Not included (job boards found by search whose JDs don't read like an HR-tech product): ${rejected.map((r) => r.name).join(", ")}.` : "",
].join("\n");
writeFileSync("data/hr-tech-remote-india.md", md + "\n");

// New HR-tech companies → seed, so the radar watches them from now on.
const newOnes = hits.filter((r) => r.origin === "discovered");
const prev = existsSync("pipeline/seed/discovered.ts") ? readFileSync("pipeline/seed/discovered.ts", "utf8") : "";
const lines = newOnes
  .filter((r) => !prev.includes(`name: ${JSON.stringify(r.name)}`))
  .map((r) => `  { name: ${JSON.stringify(r.name)}, domain: "hr_tech", category: ${JSON.stringify(r.category)}, slugs: [${JSON.stringify(r.slug)}] },`);
if (lines.length) {
  const body = prev.replace(/export const DISCOVERED: SeedCompany\[\] = \[\s*\];?/, "export const DISCOVERED: SeedCompany[] = [\n];")
    .replace(/\n\];\s*$/, `\n${lines.join("\n")}\n];\n`);
  writeFileSync("pipeline/seed/discovered.ts", body);
}

console.log(`\nTier 2 (India office/hybrid): ${tier2.length} · Tier 3 (remote, region unstated): ${tier3.length} · Tier 4 (own careers site): ${ownSite.length}`);
console.log(`\n${hits.length} HR-tech companies hiring remote from India (${newOnes.length} newly discovered, ${lines.length} added to the seed list).`);
console.log(`PM roles open to India: ${hits.reduce((s, r) => s + r.pm.length, 0)} at ${hits.filter((r) => r.pm.length).length} companies.`);
if (rejected.length) console.log(`Skipped as not HR tech: ${rejected.map((r) => r.name).join(", ")}`);
