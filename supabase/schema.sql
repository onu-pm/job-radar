-- Job Radar schema. Applied by `npm run db:migrate` (safe to re-run).
-- Row Level Security is ON with no policies: only the server-side service-role key can read/write.

create table if not exists companies (
  id            bigserial primary key,
  name          text not null unique,
  domain        text not null check (domain in ('hr_tech','b2b_saas')),
  category      text,
  ats           text not null default 'other',  -- greenhouse|lever|ashby|workable|smartrecruiters|recruitee|other
  slug          text,
  careers_url   text,
  active        boolean not null default true,
  added_by      text not null default 'seed',    -- seed|manual
  jobs_on_board integer,
  last_checked  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now()
);

create table if not exists jobs (
  id                text primary key,            -- hash of canonical URL
  dedupe_key        text not null,               -- normalized company|title
  source            text not null,
  company           text not null,
  company_id        bigint references companies(id) on delete set null,
  title             text not null,
  location          text,
  url               text not null,
  posted_at         timestamptz not null,
  first_seen        timestamptz not null default now(),
  last_checked      timestamptz not null default now(),
  jd_text           text,
  jd_full           boolean not null default false,
  -- lifecycle: pending (not yet triaged) | active (shown) | filtered | expired | closed | dead
  state             text not null default 'pending',
  filter_reason     text,
  triage            jsonb,
  domain            text,                         -- hr_tech | b2b_saas
  level             text,                         -- mid | stretch | unclear
  location_result   text,
  location_evidence text,
  -- scoring (filled once, never re-scored)
  keywords          jsonb,
  match_pct         integer,                      -- null = JD not found
  fit               integer,
  why               text,
  fix_gaps          jsonb,                        -- [{term, resume_quote, suggested_wording}]
  real_gaps         jsonb,                        -- [term]
  matched_terms     jsonb,                        -- [term]
  scored_at         timestamptz,
  score_error       text,
  hiring_post_id    text
);
create index if not exists jobs_state_idx on jobs(state);
create index if not exists jobs_dedupe_idx on jobs(dedupe_key);
create index if not exists jobs_posted_idx on jobs(posted_at desc);

-- Your status per role, separate from pipeline data so a refresh can never overwrite it.
create table if not exists job_status (
  job_id     text primary key references jobs(id) on delete cascade,
  status     text not null default 'new' check (status in ('new','applied','skip')),
  updated_at timestamptz not null default now()
);

create table if not exists posts (
  id              text primary key,              -- hash of canonical URL
  platform        text not null,                 -- linkedin | x
  url             text not null,
  posted_at       timestamptz not null,
  first_seen      timestamptz not null default now(),
  person_name     text,
  person_headline text,
  company         text,
  hiring_for      text,
  snippet         text,
  domain          text,
  state           text not null default 'pending', -- pending | active | filtered | expired
  filter_reason   text,
  triage          jsonb,
  matched_job_id  text references jobs(id) on delete set null
);
create index if not exists posts_state_idx on posts(state);

create table if not exists runs (
  id            bigserial primary key,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  trigger       text not null default 'local',   -- schedule | manual | local
  status        text not null default 'running', -- running | success | failed
  stage         text,                            -- progress line shown on the site
  sources       jsonb not null default '{}'::jsonb, -- {source: {found, too_old, filtered, scored, errors}}
  removed       jsonb not null default '{}'::jsonb, -- {expired, closed, dead}
  llm_calls     integer not null default 0,
  llm_cost_usd  numeric(10,4) not null default 0,
  serper_queries integer not null default 0,
  errors        jsonb not null default '[]'::jsonb
);

create table if not exists settings (
  key   text primary key,
  value jsonb not null
);
insert into settings(key, value) values ('include_india_onsite', 'false'::jsonb) on conflict do nothing;

alter table companies  enable row level security;
alter table jobs       enable row level security;
alter table job_status enable row level security;
alter table posts      enable row level security;
alter table runs       enable row level security;
alter table settings   enable row level security;
