// More HR-tech companies worldwide (added 2026-10-12 for the "hiring remote from India" list).
// Names already in companies.ts are skipped automatically.
import type { SeedCompany } from "./companies";

const g = (category: string, names: (string | [string, string[]])[]): SeedCompany[] =>
  names.map((n) => (Array.isArray(n) ? { name: n[0], slugs: n[1], domain: "hr_tech", category } : { name: n, domain: "hr_tech", category }));

export const HR_MORE: SeedCompany[] = [
  ...g("HRIS / HRMS / HCM", [
    "Ciphr", "Cezanne HR", "PeopleForce", "Zelt", "Hofy", "ChartHop", "Pando", "Peoplebox", "Sprout Solutions",
    "Workforce.com", "Tanda", "HR Cloud", "Paycompliance", "Neeyamo", "Zalaris", "CloudPay", "Ontop", "Bitwage",
  ]),
  ...g("Payroll, EOR & global employment", [
    "Omnipresent", "Remote People", "Boundless", "Localyze", "Jobbatical", "Envoy Global", "Firstbase", "Workwize", "Allwhere",
    ["Rippling", ["rippling", "rippling-careers"]], ["Deel", ["Deel", "deel-careers"]], "Pinwheel", "Argyle", "Atomic",
  ]),
  ...g("Recruiting / ATS / talent", [
    "Breezy HR", "JazzHR", "Comeet", "Recooty", "Hireology", "iCIMS", "Jobvite", "Employ", "SeekOut", "hireEZ", "Fetcher",
    "Findem", "Avature", "Cornerstone", "Harver", "TestGorilla", "Vervoe", "Codility", "CodeSignal", "Karat", "Coderbyte",
    "Glider AI", "Talview", "Interviewer.AI", "Pillar", "Ribbon", "Tezi", "Paraform", "Moonhub", "Hireflow",
    "Talent500", "Hirequotient", "Skillate", "Xobin",
  ]),
  ...g("Performance, engagement & L&D", [
    "Small Improvements", "PerformYard", "Windmill", "Confirm", "Nectar", "Motivosity", "Awardco", "Workhuman", "Achievers",
    "Benevity", "Staffbase", "Simpplr", "Workvivo", "Haiilo", "Firstup", "Sociabble", "Absorb LMS", "Epignosis", "Uplimit",
    "Disco", "Eletive", "Culture Monkey", "Qualee", "Klaus", "Leapsome",
  ]),
  ...g("Compensation & people analytics", [
    "Pave", "Assemble", "Compa", "Ravio", "Figures", "Payscale", "Syndio", "Comprehensive", "Kamsa", "Visier", "One Model",
    "Crunchr", "Orgvue",
  ]),
  ...g("Benefits & employee wellbeing", ["Nayya", "Leapfrog", "Modern Health", "Spring Health", "Lyra Health", "Headspace", "Wellhub"]),
  ...g("Workforce management", ["Legion", "Shiftboard", "Humanity", "Rotaready", "Skedulo", "Zinc Work"]),
  ...g("Background verification", ["First Advantage", "Veremark", "Xref", "Vouched", "Accurate Background"]),
  ...g("AI for HR / employee service", ["Atomicwork", "Espressive", "MeBeBot", "Spoke", "Hyperspace", "Sapling", "Enboarder", "ClickBoarding"]),
  ...g("Earned-wage access & employee finance", ["Rain", "Clair", "Branch", "Even"]),
];
