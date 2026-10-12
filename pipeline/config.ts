import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

export interface Config {
  models: { triage: string; scoring: string };
  pricing: Record<string, { input: number; output: number }>;
  freshness_hours: number;
  thresholds: { green: number; amber: number };
  limits: {
    max_triage_per_run: number;
    max_score_per_run: number;
    ats_concurrency: number;
    http_timeout_ms: number;
  };
  title_filter: { include: string[]; exclude: string[] };
  serper: { tbs: string; results_per_query: number; job_queries: string[]; post_queries: string[] };
}

let cached: Config | null = null;

export function config(): Config {
  if (!cached) {
    cached = YAML.parse(readFileSync(path.resolve(process.cwd(), "config.yaml"), "utf8")) as Config;
  }
  return cached;
}

export function targetProfile(): string {
  return readFileSync(path.resolve(process.cwd(), "TARGET_PROFILE.md"), "utf8");
}

/** Loads .env for local runs. In CI and on Vercel the variables are already set. */
export function loadEnv() {
  try {
    process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  } catch {
    // no .env file: fine in CI
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. Add it to .env (local) or GitHub/Vercel secrets.`);
  return v;
}
