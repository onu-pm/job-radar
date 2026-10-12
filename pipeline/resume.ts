// Resume PDF → clean text, cached as resume/resume.txt.
// The pipeline (GitHub Actions) and the scorer read resume.txt; the PDF is only re-read
// when it is newer than the cached text.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const RESUME_DIR = path.resolve(process.cwd(), "resume");
export const RESUME_PDF = path.join(RESUME_DIR, "Anupam_Product_Manager_SaaS.pdf");
export const RESUME_TXT = path.join(RESUME_DIR, "resume.txt");

function clean(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractResume(pdfPath = RESUME_PDF): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(pdfPath)));
  const { text } = await extractText(pdf, { mergePages: true });
  return clean(Array.isArray(text) ? text.join("\n") : text);
}

/** Returns the resume text, regenerating resume.txt if the PDF changed. */
export async function loadResume(): Promise<string> {
  const stale =
    !existsSync(RESUME_TXT) ||
    (existsSync(RESUME_PDF) && statSync(RESUME_PDF).mtimeMs > statSync(RESUME_TXT).mtimeMs);
  if (stale) {
    const text = await extractResume();
    writeFileSync(RESUME_TXT, text + "\n");
    return text;
  }
  return readFileSync(RESUME_TXT, "utf8").trim();
}
