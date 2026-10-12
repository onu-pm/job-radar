// npm run score -- path/to/jd.txt [more.txt ...]
// The file may start with header lines "Company: …", "Title: …", "Location: …", then a blank line, then the JD.
// Prints triage (domain/level/location) and the full scorecard. Keywords are cached per JD in .cache/.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { config, loadEnv } from "../config";
import { usage } from "../llm";
import { loadResume } from "../resume";
import { computeMatch, extractKeywords, scoreJob, type Keyword } from "../scoring";
import { decide, triage } from "../triage";

loadEnv();
const files = process.argv.slice(2);
if (!files.length) {
  console.log("Usage: npm run score -- path/to/jd.txt");
  process.exit(1);
}
const resume = await loadResume();
const { green, amber } = config().thresholds;
const color = (pct: number | null) =>
  pct == null ? "\x1b[90m" : pct >= green ? "\x1b[32m" : pct >= amber ? "\x1b[33m" : "\x1b[90m";
const B = "\x1b[1m";
const R = "\x1b[0m";
const wrap = (s: string, indent = "      ") => s.replace(/(.{1,96})(\s+|$)/g, `$1\n${indent}`).trimEnd();

for (const file of files) {
  const raw = readFileSync(file, "utf8");
  const head: Record<string, string> = {};
  let body = raw;
  const m = raw.match(/^((?:[A-Za-z]+: .*\n)+)\n/);
  if (m) {
    for (const line of m[1].trim().split("\n")) {
      const [k, ...v] = line.split(": ");
      head[k.toLowerCase()] = v.join(": ").trim();
    }
    body = raw.slice(m[0].length);
  }

  const t = await triage({ source: "ats", company: head.company, title: head.title, location: head.location, text: body });
  const d = decide(t, false);

  mkdirSync(".cache/keywords", { recursive: true });
  const cacheFile = `.cache/keywords/${createHash("sha1").update(body).digest("hex").slice(0, 16)}.json`;
  let keywords: Keyword[];
  if (existsSync(cacheFile)) keywords = JSON.parse(readFileSync(cacheFile, "utf8"));
  else {
    keywords = await extractKeywords(body);
    writeFileSync(cacheFile, JSON.stringify(keywords, null, 2));
  }
  const sc = await scoreJob({
    resumeText: resume,
    company: head.company ?? t.company ?? "?",
    roleTitle: head.title ?? t.role_title ?? "?",
    jdText: body,
    jdFound: true,
    cachedKeywords: keywords,
  });
  const m2 = computeMatch(keywords, resume);

  console.log(`\n${"═".repeat(100)}`);
  console.log(`${B}${head.company ?? t.company} — ${head.title ?? t.role_title}${R}   (${file})`);
  console.log(`${"═".repeat(100)}`);
  console.log(
    `Domain: ${t.domain === "hr_tech" ? "HR tech" : t.domain === "b2b_saas" ? "B2B SaaS" : "other"} (${t.company_category ?? "?"})` +
      `   Level: ${t.level}${t.level_evidence ? ` — "${t.level_evidence}"` : ""}`,
  );
  console.log(`Location: ${t.location_result}${t.location_evidence ? ` — "${t.location_evidence}"` : ""}`);
  console.log(`Filters: ${d.pass ? `PASS${d.stretch ? " (Stretch)" : ""}` : `WOULD BE FILTERED OUT → ${d.reason}`}`);
  console.log(
    `\n${B}Match: ${color(sc.matchPct)}${sc.matchPct}%${R}   ${B}Fit: ${sc.fit}/100${R}` +
      `   (${m2.matched.length}/${keywords.length} keywords; must ${m2.matched.filter((k) => k.type === "must").length}/${keywords.filter((k) => k.type === "must").length}, nice ${m2.matched.filter((k) => k.type === "nice").length}/${keywords.filter((k) => k.type === "nice").length})`,
  );
  console.log(`Why: ${sc.why}`);
  console.log(`\n${B}Fix before applying (${sc.fix.length})${R}`);
  if (!sc.fix.length) console.log("  —");
  for (const g of sc.fix) {
    console.log(`  • ${B}${g.term}${R} → ${wrap(g.suggested_wording ?? "", "      ")}`);
    console.log(`      resume: "${wrap(g.resume_quote ?? "", "       ")}"  ✓ quote verified`);
  }
  console.log(`\n${B}Real gaps (${sc.realGaps.length})${R}\n  ${sc.realGaps.join(", ") || "—"}`);
  if (sc.downgraded.length) console.log(`  (downgraded to real gap — quote not found in resume: ${sc.downgraded.join(", ")})`);
  console.log(`\n${B}Matched keywords${R}\n  ${sc.matchedTerms.join(", ")}`);
}
console.log(`\nLLM calls: ${usage.calls} · tokens in/out: ${usage.inputTokens}/${usage.outputTokens} · est. cost $${usage.costUsd.toFixed(4)}`);
