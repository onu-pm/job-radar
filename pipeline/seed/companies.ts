// Seed list. HR tech comes from _old/COMPANIES_SEED.md; B2B SaaS is remote-friendly companies that
// often hire PMs across time zones. `slugs` are extra guesses for the ATS probe (name-based guesses are automatic).
// Loaded into the `companies` table by `npm run detect-ats`; add more companies later on the site's database.
import { HR_MORE } from "./hr_more";
import { DISCOVERED } from "./discovered";

export interface SeedCompany {
  name: string;
  domain: "hr_tech" | "b2b_saas";
  category: string;
  slugs?: string[];
  /** Board slugs known to belong to a different company with the same name. */
  skipSlugs?: string[];
}

const hr = (category: string, names: (string | [string, string[]])[]): SeedCompany[] =>
  names.map((n) => (Array.isArray(n) ? { name: n[0], slugs: n[1], domain: "hr_tech", category } : { name: n, domain: "hr_tech", category }));
const saas = (category: string, names: (string | [string, string[]])[]): SeedCompany[] =>
  names.map((n) => (Array.isArray(n) ? { name: n[0], slugs: n[1], domain: "b2b_saas", category } : { name: n, domain: "b2b_saas", category }));

const BASE: SeedCompany[] = [
  // ---------------- HR tech ----------------
  ...hr("HRIS / HRMS / HCM", [
    "Darwinbox", ["Keka", ["kekahr", "keka-hr"]], ["greytHR", ["greythr", "greytip"]], ["Zoho People", ["zoho"]], "HROne",
    "PeopleStrong", "Zimyo", "Qandle", "sumHR", "factoHR", ["Pocket HRMS", ["pockethrms"]], "Kredily", "Akrivia HCM",
    "Beehive HRMS", "uKnowva", "Spine HR", "Rippling", ["HiBob", ["hibob", "bob"]], "Personio", ["Factorial", ["factorialhr"]],
    "BambooHR", "Gusto", "Justworks", "Namely", "Workday", "UKG", "Dayforce", "Paylocity", "Paycom", "Paycor", "isolved",
    "Humaans", "Kenjo", ["Sesame HR", ["sesametime", "sesame"]], "CharlieHR", ["Employment Hero", ["employmenthero"]],
    "Bayzat", "ZenHR", "Swingvy", "Talenox", "Leapsome", "Sage HR", "Zenefits", "HR Partner", "Breathe HR", "Lano",
  ]),
  ...hr("Payroll, EOR & global employment", [
    ["Deel", ["deel", "letsdeel"]], ["Remote", ["remote", "remotecom", "remote-com"]], ["Multiplier", ["multiplier", "usemultiplier"]],
    ["Oyster", ["oyster", "oysterhr"]], ["Papaya Global", ["papayaglobal"]], "Velocity Global", ["Globalization Partners", ["globalizationpartners", "g-p"]],
    "Atlas HXM", "Skuad", "Rivermate", "Playroll", ["Borderless AI", ["borderless", "borderlessai"]], "Safeguard Global",
    ["RazorpayX Payroll", ["razorpay"]], "PayFit", ["Check", ["checkhq", "check-technologies"]], ["Salsa", ["salsa", "salsahq"]],
    "Pilot", "Native Teams", "Remofirst", "Panther", "Worksuite", "Gloroots", "Wisemonk", "INS Global",
  ]),
  ...hr("HR unified APIs & integrations", [
    ["Knit", ["getknit"]], "Bindbee", ["Merge", ["merge"]], ["Finch", ["finch", "tryfinch"]], ["Kombo", ["kombo"]],
    "Apideck", ["Unified.to", ["unifiedto", "unified"]], "Truto", "Flexspring", "Rollout", "Paragon", "Prismatic",
  ]),
  ...hr("Recruiting / ATS / talent", [
    "Greenhouse", "Lever", "Ashby", "Workable", "SmartRecruiters", "Teamtailor", "Tellent", "Gem", ["Eightfold AI", ["eightfold", "eightfoldai"]],
    "Beamery", "Phenom", "Paradox", "HireVue", "Fountain", "Manatal", "Freshteam", "HackerEarth", "HackerRank", "iMocha",
    "Mercer Mettl", "Xobin", "Instahyre", "Cutshort", "apna", "foundit", "Pinpoint", "Dover", "Juicebox", "Metaview",
    "Welcome to the Jungle", "Hireflix", "Recruit CRM", "Zappyhire", "Hirect",
  ]),
  ...hr("Performance, engagement & L&D", [
    "Lattice", ["Culture Amp", ["cultureamp"]], "15Five", "Betterworks", "Workleap", "Quantum Workplace", "Springworks",
    "Vantage Circle", ["Empuls", ["xoxoday"]], "Mesh", "Engagedly", "Disprz", "Peakon", "Officevibe", "Leena AI", "Bonusly",
    "Assembly", "Matter", "Zavvy", "Sana", "Docebo", "360Learning", "Lessonly", "WorkRamp",
  ]),
  ...hr("Benefits & employee wellbeing", [
    ["Plum", ["plum", "plumhq"]], "Loop Health", "Pazcare", "Onsurity", "Nova Benefits", "Even Healthcare", "SafetyWing",
    "Benepass", "Forma", "Thatch", "Pluxee", "Ease", "Sequoia One", "Compt",
  ]),
  ...hr("Workforce management", [
    "Deputy", "Truein", "Jibble", "Homebase", "When I Work", "Connecteam", "Quinyx", "Planday", "7shifts", "Shiftbase", "Sling",
  ]),
  ...hr("Background verification", [
    ["SpringVerify", ["springworks"]], "AuthBridge", "IDfy", "OnGrid", "Checkr", "Certn", "Sterling", "HireRight", "Zinc",
  ]),
  ...hr("AI for HR / employee service", ["Moveworks", "Peoplelogic", "Sense", "Humanly", "Brighthire", "Workhelix", "Gloat", "Fuel50"]),
  ...hr("Earned-wage access & employee finance", ["Refyne", "Jify", "Salary Dost", "DailyPay", "Payactiv", "Wagestream", "Earnin"]),
  ...hr("Compliance / statutory for HR", ["Simpliance", "TeamLease RegTech", "Fairnow"]),

  // ---------------- B2B SaaS (remote-friendly) ----------------
  ...saas("Developer tools & infra", [
    "GitLab", "Sentry", "PostHog", "Supabase", "Vercel", "Netlify", "Render", "Railway", "Tailscale", "Grafana Labs",
    "Elastic", "Canonical", "Mattermost", "Sourcegraph", "Postman", "Hasura", "Kong", "Docker", "Clerk", "WorkOS",
    "Stytch", "LaunchDarkly", "Temporal", "Airbyte", "dbt Labs", "Fivetran", "Hightouch", "Prefect", "Appsmith", "ToolJet",
    "Retool", "n8n", "Zapier", "Make", "Celonis", "BrowserStack", "LambdaTest", "Hevo Data", "Atlan", "Weights & Biases",
  ]),
  ...saas("Collaboration & productivity", [
    "Doist", "Toggl", "Buffer", "Hotjar", "Loom", "Pitch", "Typeform", "Miro", "Airtable", "Notion", "Linear", "Coda",
    "ClickUp", "Calendly", "Webflow", "Contentful", "Storyblok", "Sanity", "Strapi", "1Password", "Zluri", "Rocketlane",
    "Whatfix", "Productboard", "Pendo", "Mixpanel", "Amplitude", "FullStory",
  ]),
  ...saas("Customer & revenue software", [
    "Intercom", "Zendesk", "Freshworks", "Help Scout", "Close", "Pipedrive", "Chargebee", "Paddle", "Recurly", "Maxio",
    "CleverTap", "MoEngage", "WebEngage", "LeadSquared", "Mindtickle", "Gupshup", "Yellow.ai", "Exotel", "Plivo", "Sprinklr",
    "Uniphore", "Observe.AI", "Gong", "Outreach", "Apollo.io", "Clari", "Front", "Gorgias", "Kustomer", "Zuora",
  ]),
  ...saas("Finance & ops software", [
    "HighRadius", "Icertis", "SpotDraft", "Pleo", "Payhawk", "Spendesk", "Agicap", "Ramp", "Brex", "Mercury", "Tipalti",
    "Navan", "Vanta", "Drata", "Druva",
  ]),
];

/** Base list + extra HR tech + companies discovered by search, de-duplicated by name (case-insensitive). */
export const SEED: SeedCompany[] = (() => {
  const seen = new Set<string>();
  const SKIP: Record<string, string[]> = { Knit: ["knit"], Mesh: ["mesh"], Disco: ["disco"] }; // same name, different company
  return [...BASE, ...HR_MORE, ...DISCOVERED].map((c) => (SKIP[c.name] ? { ...c, skipSlugs: SKIP[c.name] } : c)).filter((c) => {
    const k = c.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
})();
