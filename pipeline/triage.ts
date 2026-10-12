// Triage (cheap model): is it a real PM role, which domain, what level, can it be done from India?
// The model only reports facts; the pass/fail decision is made in code (decide()).
import { config, targetProfile } from "./config";
import { bool, llmJson, obj, oneOf, strOrNull, type Validator } from "./llm";

export const LEVELS = ["mid", "stretch", "too_junior", "too_senior", "unclear"] as const;
export const LOCATIONS = ["remote_india_ok", "overlap_ok", "india_onsite", "not_eligible", "unclear"] as const;
export const DOMAINS = ["hr_tech", "b2b_saas", "other"] as const;

export interface Triage {
  is_hiring_post: boolean;
  is_pm_role: boolean;
  domain: (typeof DOMAINS)[number];
  company_category: string | null;
  level: (typeof LEVELS)[number];
  level_evidence: string | null;
  location_result: (typeof LOCATIONS)[number];
  location_evidence: string | null;
  is_closed: boolean;
  company: string | null;
  role_title: string | null;
  apply_url: string | null;
  poster_name: string | null;
  poster_headline: string | null;
  years_required: number | null;
}

const validate: Validator<Triage> = (raw) => {
  const o = obj(raw);
  const yrs = o.years_required == null ? null : Number(o.years_required);
  return {
    is_hiring_post: bool(o.is_hiring_post, "is_hiring_post"),
    is_pm_role: bool(o.is_pm_role, "is_pm_role"),
    domain: oneOf(o.domain, DOMAINS, "domain"),
    company_category: strOrNull(o.company_category),
    level: oneOf(o.level, LEVELS, "level"),
    level_evidence: strOrNull(o.level_evidence),
    location_result: oneOf(o.location_result, LOCATIONS, "location_result"),
    location_evidence: strOrNull(o.location_evidence),
    is_closed: o.is_closed === true,
    company: strOrNull(o.company),
    role_title: strOrNull(o.role_title),
    apply_url: strOrNull(o.apply_url),
    poster_name: strOrNull(o.poster_name),
    poster_headline: strOrNull(o.poster_headline),
    years_required: Number.isFinite(yrs) ? yrs : null,
  };
};

export type LeadSource = "ats" | "remote_board" | "linkedin_job" | "linkedin_post" | "x_post";

export function triage(lead: {
  source: LeadSource;
  company?: string | null;
  title?: string | null;
  location?: string | null;
  text: string;
}): Promise<Triage> {
  return llmJson({
    model: config().models.triage,
    maxTokens: 3000,
    system:
      "You screen job leads for one candidate. Be strict about facts in the text; never guess details that aren't there. Return only JSON matching the schema.",
    user: `CANDIDATE TARGET PROFILE:
${targetProfile()}

LEAD SOURCE: ${lead.source}
COMPANY (if known): ${lead.company ?? "unknown"}
TITLE (if known): ${lead.title ?? "unknown"}
LOCATION FIELD (if any): ${lead.location ?? "none"}
TEXT:
${lead.text.slice(0, 12000)}

Answer these:
1. is_hiring_post: For posts, is someone actually hiring (not congratulating, not job-seeking, not resharing without details)? For job listings, always true.
2. is_pm_role: Is the role a Product Manager / PM II / Technical PM / Product Owner (not product marketing, project, program, design, analyst)?
3. domain: "hr_tech" if the company's main product serves HR teams or manages the workforce (HRIS, HRMS, HCM, payroll, EOR, recruiting/ATS, benefits, performance, workforce mgmt, background verification, HR integrations, AI for HR, HR compliance, employee finance). A company that merely HAS an HR department doesn't count. "b2b_saas" for other software sold to businesses. "other" for consumer, agencies, IT services, hardware, or unknown non-software. company_category: a 2–4 word label of what the company sells.
4. level: "mid" | "stretch" | "too_junior" | "too_senior" | "unclear".
   - mid: asks for about 3–7 years, OR title is Product Manager / PM II / Technical PM / Product Owner with no years given.
   - stretch: title says Senior and it asks for 6 years or fewer.
   - too_senior: asks for 8+ years, OR Senior with more than 6 years or no years given, OR Lead/Principal/Group/Staff/Director/Head/VP.
   - too_junior: APM, Associate, Intern, or under 2 years.
   Put the years-of-experience text you used in level_evidence.
5. location_result:
   - "remote_india_ok": remote AND open to India/anywhere/worldwide/APAC/Asia, or a time-zone band including IST (UTC+5:30).
   - "overlap_ok": remote with required working hours reachable from IST (Europe, Middle East, APAC hours; e.g. "4h overlap with CET").
   - "india_onsite": based in an Indian city, hybrid or onsite.
   - "not_eligible": US-only / UK-only / other single-country remote outside India, work authorization required without sponsorship, onsite/hybrid outside India, or 6+ hours of US-hours overlap.
   - "unclear": remote but the text doesn't say where from.
   Quote the location/timezone text you used in location_evidence.
6. is_closed: true only if the text says the role is closed / filled / no longer accepting applications.
7. Extract: company, role_title, apply_url (if any, from the text), poster_name and poster_headline (posts only), years_required (number or null).

Schema:
{"is_hiring_post":bool,"is_pm_role":bool,"domain":"hr_tech|b2b_saas|other","company_category":str|null,
 "level":str,"level_evidence":str|null,"location_result":str,"location_evidence":str|null,"is_closed":bool,
 "company":str|null,"role_title":str|null,"apply_url":str|null,"poster_name":str|null,
 "poster_headline":str|null,"years_required":number|null}`,
    validate,
  });
}

export type Decision = { pass: true; stretch: boolean } | { pass: false; reason: string };

/** Pass/fail lives in code. India hybrid/onsite passes only when the site setting is on. */
export function decide(t: Triage, includeIndiaOnsite: boolean): Decision {
  if (!t.is_hiring_post) return { pass: false, reason: "not a hiring post" };
  if (!t.is_pm_role) return { pass: false, reason: "not a PM role" };
  if (t.is_closed) return { pass: false, reason: "closed" };
  if (t.domain === "other") return { pass: false, reason: `domain: ${t.company_category ?? "not B2B software"}` };
  if (t.level === "too_junior" || t.level === "too_senior")
    return { pass: false, reason: `level: ${t.level}${t.level_evidence ? ` (${t.level_evidence})` : ""}` };
  if (t.location_result === "not_eligible")
    return { pass: false, reason: `location${t.location_evidence ? `: ${t.location_evidence}` : ""}` };
  if (t.location_result === "india_onsite" && !includeIndiaOnsite) return { pass: false, reason: "india_onsite" };
  return { pass: true, stretch: t.level === "stretch" };
}
