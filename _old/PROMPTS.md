# Prompts (sent through OpenRouter)

All prompts: temperature 0, ask for JSON only, validate against the schema shown, retry once on
invalid JSON. `{{…}}` are template variables.

---

## P1 — Triage (model: `models.triage`)

**System**
You screen job leads for one candidate. Be strict about facts in the text; never guess details that aren't there.
Return only JSON matching the schema.

**User**
```
CANDIDATE TARGET PROFILE:
{{TARGET_PROFILE.md}}

LEAD SOURCE: {{source}}            # ats | linkedin_post | linkedin_job | remoteok | remotive | wwr | hn
COMPANY (if known): {{company}}
TITLE (if known): {{title}}
LOCATION FIELD (if any): {{location}}
TEXT:
{{jd_or_post_text}}

Answer these:
1. is_hiring_post: For posts, is someone actually hiring (not congratulating, not job-seeking, not resharing without details)? For ATS/job boards, always true.
2. is_pm_role: Is the role a Product Manager / TPM / Product Owner (not product marketing, project, program, design, analyst)?
3. company_builds_for_hr: Does this company's main product serve HR teams or manage the workforce (HRIS, payroll, EOR, recruiting, benefits, performance, workforce mgmt, BGV, HR integrations, AI for HR, HR compliance, employee finance)? A company that merely HAS an HR department doesn't count.
4. level: "mid" | "stretch" | "too_junior" | "too_senior" | "unclear", using the profile's rules. Quote the years-of-experience text if present.
5. location_result: "remote_india_ok" | "overlap_ok" | "india_based" | "not_eligible" | "unclear". Quote the location/timezone text you used.
6. Extract: company, role_title, apply_url (if any), poster_name and poster_headline (posts only), years_required (number or null).

Schema:
{"is_hiring_post":bool,"is_pm_role":bool,"company_builds_for_hr":bool,"hr_confidence":"high|low",
 "company_category":str|null,"level":str,"level_evidence":str|null,"location_result":str,
 "location_evidence":str|null,"company":str|null,"role_title":str|null,"apply_url":str|null,
 "poster_name":str|null,"poster_headline":str|null,"years_required":number|null,
 "fail_reason":str|null}
```
Pass logic lives in code (PRD §5), not in the prompt.

---

## P2 — Keyword extraction (model: `models.scoring`)

**System**
You extract the skills and terms a hiring manager would screen a resume for. Return only JSON.

**User**
```
JOB DESCRIPTION:
{{jd_text}}

Extract 12–25 keywords that a recruiter would look for in a resume for this role.
- Prefer concrete terms: domains (e.g. "payroll", "HRIS"), skills ("API design", "A/B testing"),
  tools ("SQL", "Jira"), methods ("discovery", "roadmapping"), and outcomes ("0-to-1").
- type "must" = stated as required/must-have or repeated; "nice" = preferred/bonus/mentioned once.
- synonyms: 0–5 common variants a resume might use instead (e.g. "HRIS" → ["HRMS","HCM","HR system"]).
- Skip generic fluff ("passionate", "team player", "fast-paced").

Schema: {"keywords":[{"term":str,"type":"must|nice","synonyms":[str]}]}
```

---

## P3 — Gaps + fit (model: `models.scoring`)

**System**
You are a blunt career advisor. Use only the resume text as evidence. Never invent experience.
Return only JSON.

**User**
```
TARGET PROFILE:
{{TARGET_PROFILE.md}}

RESUME (verbatim):
{{resume_text}}

JOB: {{company}} — {{role_title}}
JD:
{{jd_text_or_snippet}}

UNMATCHED KEYWORDS (not found in the resume text):
{{unmatched_keywords_json}}

Tasks:
A. For each unmatched keyword, classify:
   - "reword": the resume already shows this experience in different words. Give `resume_quote`
     (copied EXACTLY from the resume, max 25 words) and `suggested_wording` (a truthful rewrite
     that includes the keyword).
   - "real_gap": no evidence in the resume. Give no suggestion.
B. fit: 0–100 for how seriously a hiring manager would consider this candidate, weighing domain match,
   PM type, level and location from the profile. 90+ = obvious shortlist; 70–89 = credible;
   50–69 = long shot; <50 = poor fit.
C. why: one line, max 20 words, naming the strongest reason (or the main blocker).

Schema:
{"gaps":[{"term":str,"class":"reword|real_gap","resume_quote":str|null,"suggested_wording":str|null}],
 "fit":int,"why":str}
```

**Post-check in code:** for every `reword` item, confirm that `resume_quote` appears in the resume text
(after normalizing whitespace and case). If it doesn't, change it to `real_gap` and drop the suggestion.
