// npm run resume — re-extract the resume PDF and print the first 20 lines.
import { writeFileSync } from "node:fs";
import { extractResume, RESUME_TXT } from "../resume";

const text = await extractResume();
writeFileSync(RESUME_TXT, text + "\n");
console.log(`Wrote ${RESUME_TXT} (${text.split("\n").length} lines, ${text.length} chars)\n`);
console.log(text.split("\n").slice(0, 20).map((l, i) => `${String(i + 1).padStart(2)}  ${l}`).join("\n"));
