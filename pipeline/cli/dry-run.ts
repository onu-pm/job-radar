// npm run dry-run -- [remote|ats <ats> <slug> <Company name>]
// Prints what a source finds (fresh PM-titled roles) without writing anything or calling an LLM.
import { fetchBoard } from "../sources/ats";
import { REMOTE_SOURCES } from "../sources/remote";
import { hoursAgo, type Ats, type RawJob } from "../types";

const [mode = "remote", ...rest] = process.argv.slice(2);

const show = (j: RawJob) =>
  `  ${hoursAgo(j.postedAt).toFixed(0).padStart(3)}h  ${j.company.slice(0, 22).padEnd(22)}  ${j.title.slice(0, 55).padEnd(55)}  ${(j.location ?? "").slice(0, 40)}  [JD ${j.jdText.length} chars]`;

if (mode === "ats") {
  const [ats, slug, ...name] = rest;
  const r = await fetchBoard({ ats: ats as Ats, slug, company: name.join(" ") || slug });
  console.log(`${ats}/${slug}: ${r.found} roles on board, ${r.jobs.length} fresh PM, ${r.tooOld} PM too old`);
  r.jobs.forEach((j) => console.log(show(j)));
} else {
  for (const [name, fn] of Object.entries(REMOTE_SOURCES)) {
    const t = Date.now();
    try {
      const r = await fn();
      console.log(`\n${name}: ${r.found} listings, ${r.jobs.length} fresh PM roles, ${r.tooOld} PM too old  (${Date.now() - t}ms)`);
      r.jobs.slice(0, 8).forEach((j) => console.log(show(j)));
    } catch (e) {
      console.log(`\n${name}: ERROR ${(e as Error).message}`);
    }
  }
}
