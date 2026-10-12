"use client";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { JobRow, PostRow, RunRow } from "@/lib/data";
import { setIncludeIndiaOnsite, setStatus, triggerRefresh } from "@/app/actions";

const GREEN = 90;
const AMBER = 70;

const SOURCE_LABEL: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workable: "Workable",
  smartrecruiters: "SmartRecruiters",
  recruitee: "Recruitee",
  remoteok: "RemoteOK",
  remotive: "Remotive",
  weworkremotely: "We Work Remotely",
  himalayas: "Himalayas",
  jobicy: "Jobicy",
  workingnomads: "Working Nomads",
  hackernews: "HN Who's Hiring",
  linkedin_job: "LinkedIn (via Google)",
};

const LOCATION_LABEL: Record<string, string> = {
  remote_india_ok: "Remote · India OK",
  overlap_ok: "Remote · IST overlap OK",
  india_onsite: "India hybrid/onsite",
  unclear: "Location unclear",
};

function ago(iso: string, now: number) {
  const h = Math.max(0, (now - new Date(iso).getTime()) / 3600e3);
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m ago` : `${Math.floor(h)}h ago`;
}

function matchClass(pct: number | null) {
  if (pct == null) return "m-none";
  return pct >= GREEN ? "m-green" : pct >= AMBER ? "m-amber" : "m-grey";
}

export default function Dashboard(props: {
  jobs: JobRow[];
  posts: PostRow[];
  lastRun: RunRow | null;
  includeIndiaOnsite: boolean;
  serverNow: number;
}) {
  const router = useRouter();
  const [now, setNow] = useState(props.serverNow);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const [tab, setTab] = useState<"roles" | "posts">("roles");
  const [domain, setDomain] = useState<"all" | "hr_tech" | "b2b_saas">("all");
  const [minMatch, setMinMatch] = useState(0);
  const [showStretch, setShowStretch] = useState(true);
  const [source, setSource] = useState("all");
  const [q, setQ] = useState("");
  const [showSkipped, setShowSkipped] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, JobRow["status"]>>(() =>
    Object.fromEntries(props.jobs.map((j) => [j.id, j.status])),
  );

  const sources = useMemo(() => [...new Set(props.jobs.map((j) => j.source))].sort(), [props.jobs]);

  const jobs = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return props.jobs
      .filter((j) => (domain === "all" ? true : j.domain === domain))
      .filter((j) => (minMatch > 0 ? (j.matchPct ?? -1) >= minMatch : true))
      .filter((j) => (showStretch ? true : j.level !== "stretch"))
      .filter((j) => (source === "all" ? true : j.source === source))
      .filter((j) => (showSkipped ? true : statuses[j.id] !== "skip"))
      .filter((j) =>
        needle
          ? `${j.company} ${j.title} ${j.location ?? ""} ${j.why ?? ""} ${j.matchedTerms.join(" ")}`.toLowerCase().includes(needle)
          : true,
      )
      .sort((a, b) => {
        const d = Number(b.domain === "hr_tech") - Number(a.domain === "hr_tech"); // HR tech always first
        if (d) return d;
        const m = (b.matchPct ?? -1) - (a.matchPct ?? -1);
        if (m) return m;
        return new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime();
      });
  }, [props.jobs, domain, minMatch, showStretch, source, q, showSkipped, statuses]);

  const counts = useMemo(
    () => ({
      total: props.jobs.length,
      hr: props.jobs.filter((j) => j.domain === "hr_tech").length,
      green: props.jobs.filter((j) => (j.matchPct ?? 0) >= GREEN).length,
      posts: props.posts.length,
    }),
    [props.jobs, props.posts],
  );

  // ---- refresh button + progress ----
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [run, setRun] = useState(props.lastRun);
  // pollSince = when we started waiting; a run that started after it (minus slack) and finished = done.
  const [pollSince, setPollSince] = useState<number | null>(
    props.lastRun?.status === "running" ? new Date(props.lastRun.started_at).getTime() : null,
  );
  const polling = pollSince != null;
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (pollSince == null) return;
    const t = setInterval(async () => {
      const r = await fetch("/api/latest-run", { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      if (r) setRun((prev) => ({ ...(prev ?? ({} as RunRow)), ...r }));
      const ours = r && new Date(r.started_at).getTime() >= pollSince - 60_000;
      if (ours && r.status !== "running") {
        setPollSince(null);
        setRefreshMsg(r.status === "success" ? "Refresh finished." : "Refresh failed — see Status.");
        router.refresh();
      } else if (Date.now() - pollSince > 20 * 60_000) {
        setPollSince(null);
        setRefreshMsg("Still no result after 20 minutes — check the Status page.");
      }
    }, 5000);
    return () => clearInterval(t);
  }, [pollSince, router]);

  const onRefresh = () =>
    startTransition(async () => {
      const r = await triggerRefresh();
      setRefreshMsg(r.message);
      if (r.ok) setPollSince(Date.now());
    });

  const onStatus = (id: string, s: JobRow["status"]) => {
    setStatuses((x) => ({ ...x, [id]: s }));
    setStatus(id, s).catch(() => setRefreshMsg("Couldn't save status — try again."));
  };

  const [indiaOnsite, setIndiaOnsite] = useState(props.includeIndiaOnsite);
  const onIndiaToggle = (on: boolean) => {
    setIndiaOnsite(on);
    startTransition(async () => {
      await setIncludeIndiaOnsite(on);
      router.refresh();
    });
  };

  const lastDone = run?.finished_at ?? null;

  return (
    <main className="wrap">
      <header className="top">
        <div className="brand">
          <h1>Job Radar</h1>
          <p className="muted">
            {counts.total} roles ({counts.hr} HR tech) · {counts.green} at ≥{GREEN}% · {counts.posts} hiring posts · last 48h
          </p>
        </div>
        <div className="top-right">
          <div className="muted small">
            {polling ? (
              <span className="live">● Refreshing: {run?.status === "running" ? run.stage : "starting…"}</span>
            ) : lastDone ? (
              <>Last refreshed {ago(lastDone, now)}</>
            ) : (
              "Not refreshed yet"
            )}{" "}
            · <Link href="/status">Status</Link>
          </div>
          <button className="btn" onClick={onRefresh} disabled={pending || polling}>
            {polling ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      </header>
      {refreshMsg && <p className="notice">{refreshMsg}</p>}

      <nav className="tabs">
        <button className={tab === "roles" ? "on" : ""} onClick={() => setTab("roles")}>
          Roles <span className="pill">{counts.total}</span>
        </button>
        <button className={tab === "posts" ? "on" : ""} onClick={() => setTab("posts")}>
          Hiring posts <span className="pill">{counts.posts}</span>
        </button>
      </nav>

      {tab === "roles" ? (
        <>
          <section className="filters">
            <input className="search" placeholder="Search company, role, keyword…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={domain} onChange={(e) => setDomain(e.target.value as typeof domain)} aria-label="Domain">
              <option value="all">All domains</option>
              <option value="hr_tech">HR tech</option>
              <option value="b2b_saas">B2B SaaS</option>
            </select>
            <select value={minMatch} onChange={(e) => setMinMatch(Number(e.target.value))} aria-label="Minimum match">
              <option value={0}>Any match %</option>
              <option value={50}>Match ≥ 50%</option>
              <option value={AMBER}>Match ≥ {AMBER}%</option>
              <option value={GREEN}>Match ≥ {GREEN}%</option>
            </select>
            <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
              <option value="all">All sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s] ?? s}
                </option>
              ))}
            </select>
            <label className="check">
              <input type="checkbox" checked={showStretch} onChange={(e) => setShowStretch(e.target.checked)} /> Stretch roles
            </label>
            <label className="check">
              <input type="checkbox" checked={showSkipped} onChange={(e) => setShowSkipped(e.target.checked)} /> Show skipped
            </label>
            <label className="check" title="Also include India-based hybrid/onsite roles (new ones get scored on the next refresh)">
              <input type="checkbox" checked={indiaOnsite} onChange={(e) => onIndiaToggle(e.target.checked)} /> India hybrid/onsite
            </label>
          </section>

          {jobs.length === 0 ? (
            <p className="empty">No roles match these filters.</p>
          ) : (
            <table className="grid roles">
              <thead>
                <tr>
                  <th>Posted</th>
                  <th>Company</th>
                  <th>Role</th>
                  <th>Domain</th>
                  <th>Remote eligibility</th>
                  <th className="num">Match</th>
                  <th className="num">Fit</th>
                  <th>Fix before applying</th>
                  <th>Apply</th>
                  <th>Hiring post</th>
                  <th>Source</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const isOpen = open === j.id;
                  return (
                    <Fragment key={j.id}>
                      <tr
                        className={`row ${isOpen ? "open" : ""} ${statuses[j.id] === "skip" ? "skipped" : ""}`}
                        onClick={() => setOpen(isOpen ? null : j.id)}
                      >
                        <td data-l="Posted" className="nowrap muted">{ago(j.postedAt, now)}</td>
                        <td data-l="Company" className="strong">{j.company}</td>
                        <td data-l="Role">
                          {j.title}
                          {j.level === "stretch" && <span className="tag stretch">Stretch</span>}
                        </td>
                        <td data-l="Domain">
                          {j.domain && <span className={`tag ${j.domain}`}>{j.domain === "hr_tech" ? "HR tech" : "B2B SaaS"}</span>}
                        </td>
                        <td data-l="Remote" className="small" title={j.locationEvidence ?? j.location ?? ""}>
                          {LOCATION_LABEL[j.locationResult ?? ""] ?? "—"}
                        </td>
                        <td data-l="Match" className="num">
                          {!j.scored ? (
                            <span className="muted small">scoring…</span>
                          ) : j.matchPct == null ? (
                            <span className="badge m-none" title="JD not found">— <small>JD not found</small></span>
                          ) : (
                            <span className={`badge ${matchClass(j.matchPct)}`}>{j.matchPct}%</span>
                          )}
                        </td>
                        <td data-l="Fit" className="num">{j.fit ?? "—"}</td>
                        <td data-l="Fix">
                          {j.scored ? (
                            <button className="linkish" onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : j.id); }}>
                              {j.fixGaps.length} to fix {isOpen ? "▴" : "▾"}
                            </button>
                          ) : "—"}
                        </td>
                        <td data-l="Apply">
                          <a href={j.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Apply ↗</a>
                        </td>
                        <td data-l="Post">
                          {j.hiringPostUrl ? (
                            <a href={j.hiringPostUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Post ↗</a>
                          ) : <span className="muted">—</span>}
                        </td>
                        <td data-l="Source" className="small muted">{SOURCE_LABEL[j.source] ?? j.source}</td>
                        <td data-l="Status" onClick={(e) => e.stopPropagation()}>
                          <select
                            className={`status s-${statuses[j.id]}`}
                            value={statuses[j.id]}
                            onChange={(e) => onStatus(j.id, e.target.value as JobRow["status"])}
                            aria-label="Status"
                          >
                            <option value="new">New</option>
                            <option value="applied">Applied</option>
                            <option value="skip">Skip</option>
                          </select>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="detail">
                          <td colSpan={12}>
                            <Detail j={j} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <Posts posts={props.posts} now={now} onJump={(id) => { setTab("roles"); setOpen(id); setShowSkipped(true); }} />
      )}
    </main>
  );
}

function Detail({ j }: { j: JobRow }) {
  return (
    <div className="detail-body">
      {j.why && <p className="why"><strong>Why:</strong> {j.why}</p>}
      {!j.jdFound && <p className="muted">JD not found — scored on the listing snippet only, so there's no match %.</p>}
      <h3>Fix before applying ({j.fixGaps.length})</h3>
      {j.fixGaps.length === 0 ? (
        <p className="muted">Nothing to reword.</p>
      ) : (
        <ul className="fix">
          {j.fixGaps.map((g) => (
            <li key={g.term}>
              <div><span className="term">{g.term}</span> → {g.suggested_wording}</div>
              <div className="quote">Resume: “{g.resume_quote}”</div>
            </li>
          ))}
        </ul>
      )}
      <h3>Real gaps ({j.realGaps.length})</h3>
      <p>{j.realGaps.length ? j.realGaps.join(", ") : <span className="muted">None</span>}</p>
      <h3>Matched keywords ({j.matchedTerms.length})</h3>
      <p className="chips">{j.matchedTerms.map((t) => <span key={t} className="chip">{t}</span>)}</p>
      <p className="small muted">
        {j.location && <>Location as posted: {j.location} · </>}
        <a href={j.url} target="_blank" rel="noopener noreferrer">Full JD ↗</a>
      </p>
    </div>
  );
}

function Posts({ posts, now, onJump }: { posts: PostRow[]; now: number; onJump: (jobId: string) => void }) {
  if (!posts.length) return <p className="empty">No hiring posts from the last 48 hours yet.</p>;
  return (
    <table className="grid posts">
      <thead>
        <tr>
          <th>Posted</th>
          <th>Person</th>
          <th>Company</th>
          <th>Hiring for</th>
          <th>Post</th>
          <th>Matched role</th>
        </tr>
      </thead>
      <tbody>
        {posts.map((p) => (
          <tr key={p.id} className="row">
            <td data-l="Posted" className="nowrap muted">{ago(p.postedAt, now)}</td>
            <td data-l="Person">
              <div className="strong">{p.personName ?? "—"}</div>
              {p.personHeadline && <div className="small muted">{p.personHeadline}</div>}
            </td>
            <td data-l="Company">
              {p.company ?? "—"}
              {p.domain && <span className={`tag ${p.domain}`}>{p.domain === "hr_tech" ? "HR tech" : "B2B SaaS"}</span>}
            </td>
            <td data-l="Hiring for" title={p.snippet ?? ""}>{p.hiringFor ?? "Product Manager"}</td>
            <td data-l="Post">
              <a href={p.url} target="_blank" rel="noopener noreferrer">{p.platform === "x" ? "X" : "LinkedIn"} ↗</a>
            </td>
            <td data-l="Matched role">
              {p.matchedJobId ? (
                <button className="linkish" onClick={() => onJump(p.matchedJobId!)}>{p.matchedJobTitle ?? "View role"}</button>
              ) : <span className="muted">—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
