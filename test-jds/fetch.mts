// One-off: save 3 real JDs (strong / medium / poor) for the scoring test.
import { writeFileSync } from "node:fs";
import { getJson, htmlToText } from "../pipeline/http";
const save = (f: string, company: string, title: string, loc: string, url: string, body: string) => {
  writeFileSync(`test-jds/${f}`, `Company: ${company}\nTitle: ${title}\nLocation: ${loc}\nUrl: ${url}\n\n${body}\n`);
  console.log(`${f}: ${company} — ${title} [${loc}] ${body.length} chars`);
};
const gh = (slug: string, id: string) => getJson<any>(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}`);
const jw = await gh("justworks", "8113972");
save("1-strong-justworks.txt", "Justworks", jw.title, jw.location?.name, jw.absolute_url, htmlToText(jw.content));
const ph = (await getJson<any>("https://api.ashbyhq.com/posting-api/job-board/posthog")).jobs.find((j: any) => j.id === "3c592b84-8b34-4ae4-ae23-cadce8f2212d");
save("2-medium-posthog.txt", "PostHog", ph.title, `${ph.location} ${ph.workplaceType ?? ""}`, ph.jobUrl, ph.descriptionPlain);
const g = await gh("gusto", "8160675");
save("3-poor-gusto.txt", "Gusto", g.title, g.location?.name, g.absolute_url, htmlToText(g.content));
