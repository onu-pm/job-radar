// Scoring: keyword extraction (LLM) → match % (code) → gaps + fit (LLM) → quote check (code).
import { config, targetProfile } from "./config";
import { llmJson, obj, oneOf, str, strOrNull, type Validator } from "./llm";

export interface Keyword {
  term: string;
  type: "must" | "nice";
  synonyms: string[];
}

export interface MatchResult {
  matchPct: number;
  matched: Keyword[];
  unmatched: Keyword[];
}

export interface Gap {
  term: string;
  class: "fix" | "real_gap";
  resume_quote: string | null;
  suggested_wording: string | null;
}

export interface GapResult {
  gaps: Gap[];
  fit: number;
  why: string;
  downgraded: string[]; // "fix" items whose quote wasn't found in the resume
}

// ---- 1. keyword extraction (P2) ---------------------------------------------

const validateKeywords: Validator<Keyword[]> = (raw) => {
  const list = obj(raw).keywords;
  if (!Array.isArray(list)) throw new Error("keywords is not an array");
  const out: Keyword[] = [];
  const seen = new Set<string>();
  for (const k of list) {
    const o = obj(k, "keyword");
    const term = str(o.term, "term").trim();
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    const synonyms = Array.isArray(o.synonyms)
      ? o.synonyms.filter((s): s is string => typeof s === "string" && s.trim() !== "").slice(0, 5)
      : [];
    out.push({ term, type: oneOf(o.type, ["must", "nice"] as const, "type"), synonyms });
  }
  if (out.length < 5) throw new Error(`only ${out.length} keywords`);
  return out.slice(0, 25);
};

export function extractKeywords(jdText: string): Promise<Keyword[]> {
  return llmJson({
    model: config().models.scoring,
    system: "You extract the skills and terms a hiring manager would screen a resume for. Return only JSON.",
    user: `JOB DESCRIPTION:
${jdText.slice(0, 30000)}

Extract 12–25 keywords that a recruiter would look for in a resume for this role.
- Prefer concrete terms: domains (e.g. "payroll", "HRIS"), skills ("API design", "A/B testing"),
  tools ("SQL", "Jira"), methods ("discovery", "roadmapping"), and outcomes ("0-to-1").
- Keep each term short (1–4 words), the way it would be written on a resume.
- type "must" = stated as required/must-have or repeated; "nice" = preferred/bonus/mentioned once.
- synonyms: 0–5 common variants a resume might use instead (e.g. "HRIS" → ["HRMS","HCM","HR system"]).
- Skip generic fluff ("passionate", "team player", "fast-paced").
- Skip soft skills and personality traits ("communication", "detail-oriented", "proactive", "ownership", "judgment",
  "collaboration"), work arrangements ("remote", "office attendance", "travel"), years of experience, degrees and locations.
- Every keyword must be a skill, domain, tool, method or outcome a recruiter could find written on a resume.

Schema: {"keywords":[{"term":str,"type":"must|nice","synonyms":[str]}]}`,
    validate: validateKeywords,
  });
}

// ---- 2. match % — computed in code, never by the LLM --------------------------

/** lowercase, unify quotes, turn every non-word char (incl. "/" and "-") into a space, collapse spaces. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Variants of one keyword: the term, its synonyms, and slash-separated parts ("HRIS/HRMS"). */
function variants(k: Keyword): string[] {
  const raw = [k.term, ...k.synonyms];
  const parts = raw.flatMap((t) => (t.includes("/") && !/^a\/b\b/i.test(t) ? [t, ...t.split("/")] : [t]));
  return [...new Set(parts.map(normalize).filter((v) => v.length > 0))];
}

/** Word-boundary, case-insensitive; a trailing plural "s"/"es" is tolerated on both sides. */
function containsPhrase(normText: string, phrase: string): boolean {
  const stem = phrase.replace(/(es|s)$/, "");
  const base = stem.length >= 3 ? stem : phrase;
  const re = new RegExp(`(?:^| )${escapeRe(base)}(?:s|es)?(?= |$)`);
  return re.test(normText);
}

export function computeMatch(keywords: Keyword[], resumeText: string): MatchResult {
  const text = normalize(resumeText);
  const matched: Keyword[] = [];
  const unmatched: Keyword[] = [];
  for (const k of keywords) (variants(k).some((v) => containsPhrase(text, v)) ? matched : unmatched).push(k);
  const weight = (k: Keyword) => (k.type === "must" ? 2 : 1);
  const total = keywords.reduce((s, k) => s + weight(k), 0);
  const got = matched.reduce((s, k) => s + weight(k), 0);
  return { matchPct: total ? Math.round((got / total) * 100) : 0, matched, unmatched };
}

// ---- 3. gaps + fit (P3) and the quote check -----------------------------------

/** Whitespace/case/quote/bullet-insensitive form used for the "quote really exists" check. */
function quoteNorm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[●•▪]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:'"]+|[\s.,;:'"]+$/g, "")
    .trim();
}

export function quoteInResume(quote: string, resumeText: string): boolean {
  const q = quoteNorm(quote);
  return q.length >= 8 && quoteNorm(resumeText).includes(q);
}

const validateGaps =
  (unmatched: Keyword[]): Validator<Omit<GapResult, "downgraded">> =>
  (raw) => {
    const o = obj(raw);
    const fit = Number(o.fit);
    if (!Number.isFinite(fit) || fit < 0 || fit > 100) throw new Error("fit must be 0–100");
    const why = str(o.why, "why").trim();
    if (!Array.isArray(o.gaps)) throw new Error("gaps is not an array");
    const byTerm = new Map<string, Gap>();
    for (const g of o.gaps) {
      const go = obj(g, "gap");
      const term = str(go.term, "gap.term");
      byTerm.set(term.toLowerCase(), {
        term,
        class: oneOf(go.class, ["fix", "real_gap"] as const, "gap.class"),
        resume_quote: strOrNull(go.resume_quote),
        suggested_wording: strOrNull(go.suggested_wording),
      });
    }
    // Every unmatched keyword must come back exactly once; anything the model skipped is a real gap.
    const gaps = unmatched.map(
      (k) =>
        byTerm.get(k.term.toLowerCase()) ?? { term: k.term, class: "real_gap" as const, resume_quote: null, suggested_wording: null },
    );
    return { gaps, fit: Math.round(fit), why };
  };

export async function classifyGaps(args: {
  resumeText: string;
  company: string;
  roleTitle: string;
  jdText: string;
  unmatched: Keyword[];
  jdFound: boolean;
}): Promise<GapResult> {
  const result = await llmJson({
    model: config().models.scoring,
    system: "You are a blunt career advisor. Use only the resume text as evidence. Never invent experience. Return only JSON.",
    user: `TARGET PROFILE:
${targetProfile()}

RESUME (verbatim):
${args.resumeText}

JOB: ${args.company} — ${args.roleTitle}
${args.jdFound ? "JD" : "JD NOT FOUND — only this snippet is available"}:
${args.jdText.slice(0, 30000)}

UNMATCHED KEYWORDS (not found in the resume text):
${JSON.stringify(args.unmatched.map((k) => ({ term: k.term, type: k.type })))}

Tasks:
A. For each unmatched keyword, classify:
   - "fix": the resume already shows this experience in different words, so the candidate should reword
     before applying. Give \`resume_quote\` (copied EXACTLY, character for character, from ONE place in the
     resume, max 25 words, no "●" bullet) and \`suggested_wording\` (a truthful rewrite of that line that
     includes the keyword). The rewrite must NEVER change a job title, seniority, company name, date or number,
     and must not claim any tool, domain or scope the quoted line doesn't already show. If the only honest
     rewrite would be a stretch, classify it "real_gap" instead.
   - "real_gap": no evidence in the resume. Give no quote and no suggestion. Never suggest adding it.
B. fit: 0–100 for how seriously a hiring manager would consider this candidate, weighing domain match,
   PM type, level and location from the profile. 90+ = obvious shortlist; 70–89 = credible;
   50–69 = long shot; <50 = poor fit.
C. why: one line, max 20 words, naming the strongest reason (or the main blocker).

Schema:
{"gaps":[{"term":str,"class":"fix|real_gap","resume_quote":str|null,"suggested_wording":str|null}],
 "fit":int,"why":str}`,
    validate: validateGaps(args.unmatched),
  });

  // Post-check in code: a "fix" without a verbatim resume quote becomes a real gap.
  const downgraded: string[] = [];
  const gaps = result.gaps.map((g): Gap => {
    if (g.class !== "fix") return { ...g, resume_quote: null, suggested_wording: null };
    if (g.resume_quote && g.suggested_wording && quoteInResume(g.resume_quote, args.resumeText)) return g;
    downgraded.push(g.term);
    return { term: g.term, class: "real_gap", resume_quote: null, suggested_wording: null };
  });
  return { ...result, gaps, downgraded };
}

// ---- full scorecard ------------------------------------------------------------

export interface Scorecard {
  keywords: Keyword[] | null;
  matchPct: number | null; // null = JD not found
  matchedTerms: string[];
  fix: Gap[];
  realGaps: string[];
  fit: number;
  why: string;
  downgraded: string[];
}

/**
 * Scores one job. Pass `cachedKeywords` to reuse a stored keyword list (same JD → same list → same %).
 * When the full JD isn't available, match % is null and only fit/why are produced.
 */
export async function scoreJob(args: {
  resumeText: string;
  company: string;
  roleTitle: string;
  jdText: string;
  jdFound: boolean;
  cachedKeywords?: Keyword[] | null;
}): Promise<Scorecard> {
  if (!args.jdFound) {
    const g = await classifyGaps({ ...args, unmatched: [] });
    return { keywords: null, matchPct: null, matchedTerms: [], fix: [], realGaps: [], fit: g.fit, why: g.why, downgraded: [] };
  }
  const keywords = args.cachedKeywords ?? (await extractKeywords(args.jdText));
  const m = computeMatch(keywords, args.resumeText);
  const g = await classifyGaps({ ...args, unmatched: m.unmatched });
  return {
    keywords,
    matchPct: m.matchPct,
    matchedTerms: m.matched.map((k) => k.term),
    fix: g.gaps.filter((x) => x.class === "fix"),
    realGaps: g.gaps.filter((x) => x.class === "real_gap").map((x) => x.term),
    fit: g.fit,
    why: g.why,
    downgraded: g.downgraded,
  };
}
