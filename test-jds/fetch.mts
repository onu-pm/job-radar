// One-off: save 4 real JDs (strong / medium / poor / India HR-tech) for the scoring test.
import { writeFileSync } from "node:fs";
import { getJson, htmlToText } from "../pipeline/http";
const save = (f: string, company: string, title: string, loc: string, url: string, body: string) => {
  writeFileSync(`test-jds/${f}`, `Company: ${company}\nTitle: ${title}\nLocation: ${loc}\nUrl: ${url}\n\n${body}\n`);
  console.log(`${f}: ${company} — ${title} [${loc}] ${body.length} chars`);
};
const ashby = async (slug: string, id: string) => (await getJson<any>(`https://api.ashbyhq.com/posting-api/job-board/${slug}`)).jobs.find((j: any) => j.id === id);
const check = await ashby("check-technologies", "f97a7dd6-21f3-480c-a06d-f443fffdda16");
save("1-strong-check.txt", "Check", check.title, `${check.location} ${check.workplaceType ?? ""}`, check.jobUrl, check.descriptionPlain);
const ph = await ashby("posthog", "3c592b84-8b34-4ae4-ae23-cadce8f2212d");
save("2-medium-posthog.txt", "PostHog", ph.title, `${ph.location} ${ph.workplaceType ?? ""}`, ph.jobUrl, ph.descriptionPlain);
const g = await getJson<any>("https://boards-api.greenhouse.io/v1/boards/gusto/jobs/8160675");
save("3-poor-gusto.txt", "Gusto", g.title, g.location?.name, g.absolute_url, htmlToText(g.content));
const him = await getJson<any>("https://himalayas.app/jobs/api/search?q=product+owner&page=1");
const pg = (him.jobs ?? []).find((j: any) => /People's Growth/i.test(j.companyName));
if (pg) save("4-india-hrtech-peoplesgrowth.txt", pg.companyName, pg.title, `Remote · ${(pg.locationRestrictions ?? []).join(", ")}`, pg.applicationLink ?? pg.guid, htmlToText(pg.description));
else console.log("People's Growth role not in Himalayas search right now");
