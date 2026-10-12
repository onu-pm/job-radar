// Polite HTTP helpers: timeouts, a clear user agent, no retries hammering a board.
import * as cheerio from "cheerio";
import { config } from "./config";

export const UA = "Mozilla/5.0 (compatible; JobRadar/1.0; personal job alerts, low volume)";

export async function getJson<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(config().limits.http_timeout_ms),
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return (await res.json()) as T;
}

export async function getText(url: string, init: RequestInit = {}): Promise<{ status: number; text: string; finalUrl: string }> {
  const res = await fetch(url, {
    redirect: "follow",
    ...init,
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml,*/*", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(config().limits.http_timeout_ms),
  });
  return { status: res.status, text: res.ok ? await res.text() : "", finalUrl: res.url };
}

export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status} ${url}`);
  }
}

/** HTML (or HTML-escaped HTML) → readable plain text with line breaks kept. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  let src = html;
  if (/&lt;\/?[a-z]/i.test(src) && !/<\/?[a-z]/i.test(src)) src = cheerio.load(`<x>${src}</x>`)("x").text(); // unescape
  const $ = cheerio.load(src);
  $("script, style, noscript, svg, iframe, nav, footer, header, form").remove();
  $("br").replaceWith("\n");
  $("p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article, ul, ol").each((_, el) => {
    $(el).prepend("\n");
    $(el).append("\n");
  });
  $("li").each((_, el) => {
    $(el).prepend("• ");
  });
  return $.root()
    .text()
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Runs tasks with a small concurrency limit. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}
