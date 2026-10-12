// OpenRouter chat calls that must return strict JSON.
// Every call: temperature 0, JSON only, validated; one retry on invalid output; cost tracked.
import { config, requireEnv } from "./config";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export const usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };

export class LlmError extends Error {}

/** Thrown when today's LLM call budget (limits.llm_calls_per_day) is used up. Never retried. */
export class BudgetError extends Error {}

/** Calls this process may still make; set by the pipeline from today's runs. Infinity = no cap. */
let remaining = Infinity;
export function setCallBudget(n: number) {
  remaining = Math.max(0, n);
}
export function callsLeft() {
  return remaining;
}

/** A validator returns the typed value, or throws with a reason. */
export type Validator<T> = (raw: unknown) => T;

function parseJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object in reply");
  return JSON.parse(trimmed.slice(start, end + 1));
}

async function callOnce(model: string, system: string, user: string, maxTokens: number): Promise<string> {
  if (remaining <= 0) throw new BudgetError("daily LLM call budget used up");
  remaining -= 1;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("OPENROUTER_API_KEY")}`,
      "Content-Type": "application/json",
      "X-Title": "Job Radar",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      usage: { include: true },
      // Reasoning models: think briefly and don't return the thinking, so the answer fits.
      reasoning: { effort: "low", exclude: true },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new LlmError(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };
  const inTok = body.usage?.prompt_tokens ?? 0;
  const outTok = body.usage?.completion_tokens ?? 0;
  const price = config().pricing[model];
  usage.calls += 1;
  usage.inputTokens += inTok;
  usage.outputTokens += outTok;
  usage.costUsd +=
    body.usage?.cost ?? (price ? (inTok * price.input + outTok * price.output) / 1e6 : 0);
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("empty reply");
  return content;
}

export async function llmJson<T>(opts: {
  model: string;
  system: string;
  user: string;
  validate: Validator<T>;
  maxTokens?: number;
}): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const content = await callOnce(opts.model, opts.system, opts.user, opts.maxTokens ?? 8000);
      return opts.validate(parseJson(content));
    } catch (e) {
      if (e instanceof BudgetError) throw e;
      if (e instanceof LlmError && !/ 5\d\d:| 429:/.test(e.message)) throw e; // auth/billing errors: don't retry
      if (e instanceof LlmError && / 429:/.test(e.message)) await new Promise((r) => setTimeout(r, 15_000)); // free-tier rate limit
      lastErr = e;
    }
  }
  throw new Error(`LLM JSON failed after retry: ${(lastErr as Error)?.message ?? lastErr}`);
}

// ---- tiny validation helpers -------------------------------------------------
export function obj(v: unknown, what = "value"): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${what} is not an object`);
  return v as Record<string, unknown>;
}
export function str(v: unknown, what: string): string {
  if (typeof v !== "string") throw new Error(`${what} is not a string`);
  return v;
}
export function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
export function bool(v: unknown, what: string): boolean {
  if (typeof v !== "boolean") throw new Error(`${what} is not a boolean`);
  return v;
}
export function oneOf<T extends string>(v: unknown, options: readonly T[], what: string): T {
  if (typeof v !== "string" || !options.includes(v as T)) throw new Error(`${what} must be one of ${options.join("|")}`);
  return v as T;
}
