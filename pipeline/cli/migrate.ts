// npm run db:migrate — create/update tables, then load data/companies.json into `companies`.
// Re-runnable: existing companies keep their manual edits (active flag, added rows); only ATS/slug
// for seed rows are refreshed.
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";
import { loadEnv, requireEnv } from "../config";

loadEnv();

/**
 * Parses the Supabase connection string tolerantly: a password containing "@" or "#" (which a URL or
 * .env parser would cut) and Supabase's "[YOUR-PASSWORD]" brackets left in place both still work.
 * Reads the raw .env line when present, because .env parsing treats "#" as the start of a comment.
 */
function dbConfig(): pg.ClientConfig {
  let raw = requireEnv("SUPABASE_DB_URL");
  if (existsSync(".env")) {
    const line = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("SUPABASE_DB_URL="));
    if (line) raw = line.slice("SUPABASE_DB_URL=".length).trim().replace(/^["']|["']$/g, "");
  }
  const m = raw.match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^@/:]+)(?::(\d+))?\/([^?]*)/);
  if (!m) throw new Error("SUPABASE_DB_URL doesn't look like postgresql://user:password@host:port/db");
  let password = m[2];
  if (password.startsWith("[") && password.endsWith("]")) password = password.slice(1, -1);
  try {
    password = decodeURIComponent(password);
  } catch {
    // not URL-encoded: use as is
  }
  return { user: m[1], password, host: m[3], port: Number(m[4] ?? 5432), database: m[5] || "postgres", ssl: { rejectUnauthorized: false } };
}

const client = new pg.Client(dbConfig());
await client.connect();
await client.query(readFileSync("supabase/schema.sql", "utf8"));
console.log("Schema applied.");

const companies: any[] = JSON.parse(readFileSync("data/companies.json", "utf8"));
let n = 0;
for (const c of companies) {
  await client.query(
    `insert into companies(name, domain, category, ats, slug, jobs_on_board, added_by)
     values ($1,$2,$3,$4,$5,$6,'seed')
     on conflict (name) do update set
       ats = case when companies.added_by = 'seed' then excluded.ats else companies.ats end,
       slug = case when companies.added_by = 'seed' then excluded.slug else companies.slug end,
       jobs_on_board = excluded.jobs_on_board`,
    [c.name, c.domain, c.category, c.ats, c.slug, c.jobs_on_board],
  );
  n++;
}
const { rows } = await client.query(
  `select domain, count(*)::int total, count(*) filter (where ats <> 'other')::int on_ats from companies group by domain order by domain`,
);
console.log(`Loaded ${n} seed companies.`, rows);
await client.end();
