// npm run detect-ats — probe each seed company's public job-board APIs and write data/companies.json.
// Safe to re-run: companies already resolved in data/companies.json are skipped unless --all.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { probe, slugCandidates } from "../sources/ats";
import { pool } from "../http";
import { SEED, type SeedCompany } from "../seed/companies";
import { ATS_LIST, type Ats } from "../types";

export interface CompanyRow extends SeedCompany {
  ats: Ats | "other";
  slug: string | null;
  jobs_on_board: number | null;
}

const OUT = "data/companies.json";
const all = process.argv.includes("--all");
const redoWeak = process.argv.includes("--redo-weak"); // re-probe companies resolved to an empty board
const prev: CompanyRow[] = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
const prevByName = new Map(prev.map((c) => [c.name, c]));

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** When the ATS tells us the board's company name, it must resemble ours (guards against "Close" → some other Close). */
const sameCompany = (ours: string, theirs: string | null) => {
  if (!theirs) return true;
  const a = norm(ours.replace(/\(.*?\)/g, ""));
  const b = norm(theirs);
  return a.includes(b) || b.includes(a) || a.slice(0, 5) === b.slice(0, 5);
};

async function detect(c: SeedCompany): Promise<CompanyRow> {
  const slugs = slugCandidates(c.name, c.slugs ?? []).filter((s) => !(c.skipSlugs ?? []).includes(s));
  // An empty board is a weak hit: keep looking for a board with jobs, fall back to the empty one.
  // Workable answers for dormant/unrelated account names, so an empty Workable board never counts.
  let weak: CompanyRow | null = null;
  for (const ats of ATS_LIST) {
    const tries = ats === "smartrecruiters" ? [...slugs, c.name.replace(/[^A-Za-z0-9]/g, "")] : slugs;
    for (const slug of [...new Set(tries)]) {
      const hit = await probe(ats, slug);
      // Slugs written into the seed list by hand are trusted even if the board's display name differs ("G-P").
      if (!hit || (!(c.slugs ?? []).includes(slug) && !sameCompany(c.name, hit.boardName))) continue;
      if (hit.jobs > 0) return { ...c, ats, slug, jobs_on_board: hit.jobs };
      if (ats !== "workable") weak ??= { ...c, ats, slug, jobs_on_board: 0 };
    }
  }
  return weak ?? { ...c, ats: "other", slug: null, jobs_on_board: null };
}

const t0 = Date.now();
const rows = await pool(SEED, 8, async (c) => {
  const old = prevByName.get(c.name);
  if (old && old.slug && (c.skipSlugs ?? []).includes(old.slug)) return { ...c, ats: "other" as const, slug: null, jobs_on_board: null };
  const weakOld = old && (old.jobs_on_board === 0 || old.ats === "workable");
  if (old && !all && !(redoWeak && weakOld) && (old.ats !== "other" || redoWeak)) return { ...c, ats: old.ats, slug: old.slug, jobs_on_board: old.jobs_on_board };
  const r = await detect(c);
  process.stdout.write(r.ats === "other" ? "." : "+");
  return r;
});

mkdirSync("data", { recursive: true });
writeFileSync(OUT, JSON.stringify(rows, null, 2) + "\n");

const by = (d: string) => rows.filter((r) => r.domain === d);
console.log(`\n\n${rows.length} companies in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const d of ["hr_tech", "b2b_saas"]) {
  const g = by(d);
  const resolved = g.filter((r) => r.ats !== "other");
  console.log(`${d}: ${g.length} companies, ${resolved.length} on a supported ATS, ${g.length - resolved.length} other`);
}
const counts: Record<string, number> = {};
for (const r of rows) counts[r.ats] = (counts[r.ats] ?? 0) + 1;
console.log("by ATS:", counts);
