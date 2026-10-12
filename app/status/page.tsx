import Link from "next/link";
import { loadRuns } from "@/lib/data";

export const dynamic = "force-dynamic";

const ist = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function StatusPage() {
  const runs = await loadRuns(30);
  const monthCost = runs
    .filter((r) => Date.now() - new Date(r.started_at).getTime() < 30 * 86400e3)
    .reduce((s, r) => s + Number(r.llm_cost_usd), 0);
  const latest = runs[0];
  return (
    <main className="wrap">
      <header className="top">
        <div className="brand">
          <h1>Status</h1>
          <p className="muted">
            Last {runs.length} refreshes · LLM cost in this list ≈ ${monthCost.toFixed(2)} · times in IST
          </p>
        </div>
        <Link className="btn ghost" href="/">← Back to roles</Link>
      </header>

      {latest && (
        <section className="card">
          <h2>
            Latest run · {ist(latest.started_at)} · <span className={`run-${latest.status}`}>{latest.status}</span>
            {latest.status === "running" && <> · {latest.stage}</>}
          </h2>
          <table className="grid compact">
            <thead>
              <tr>
                <th>Source</th>
                <th className="num">Found</th>
                <th className="num">Too old</th>
                <th className="num">New</th>
                <th className="num">Filtered</th>
                <th className="num">Scored</th>
                <th className="num">Errors</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(latest.sources ?? {})
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, s]) => (
                  <tr key={name}>
                    <td data-l="Source">{name}</td>
                    <td data-l="Found" className="num">{s.found}</td>
                    <td data-l="Too old" className="num">{s.too_old}</td>
                    <td data-l="New" className="num">{s.new}</td>
                    <td data-l="Filtered" className="num">{s.filtered}</td>
                    <td data-l="Scored" className="num">{s.scored}</td>
                    <td data-l="Errors" className={`num ${s.errors ? "err" : ""}`}>{s.errors}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="small muted">
            Removed this run: {latest.removed?.expired ?? 0} older than 48h · {latest.removed?.closed ?? 0} closed ·{" "}
            {latest.removed?.dead ?? 0} dead links · LLM calls {latest.llm_calls} (≈ ${Number(latest.llm_cost_usd).toFixed(3)}) ·
            Google searches {latest.serper_queries}
          </p>
          {latest.errors?.length > 0 && (
            <details>
              <summary>{latest.errors.length} errors</summary>
              <ul className="small">{latest.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </details>
          )}
        </section>
      )}

      <section className="card">
        <h2>History</h2>
        <table className="grid compact">
          <thead>
            <tr>
              <th>Started (IST)</th>
              <th>Trigger</th>
              <th>Result</th>
              <th className="num">Minutes</th>
              <th className="num">New</th>
              <th className="num">Scored</th>
              <th className="num">Removed</th>
              <th className="num">LLM $</th>
              <th className="num">Errors</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const tot = (k: "new" | "scored") => Object.values(r.sources ?? {}).reduce((s, x) => s + (x[k] ?? 0), 0);
              const rem = (r.removed?.expired ?? 0) + (r.removed?.closed ?? 0) + (r.removed?.dead ?? 0);
              const mins = r.finished_at ? ((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 60e3).toFixed(1) : "—";
              return (
                <tr key={r.id}>
                  <td data-l="Started">{ist(r.started_at)}</td>
                  <td data-l="Trigger">{r.trigger}</td>
                  <td data-l="Result" className={`run-${r.status}`}>{r.status === "running" ? r.stage : r.status}</td>
                  <td data-l="Minutes" className="num">{mins}</td>
                  <td data-l="New" className="num">{tot("new")}</td>
                  <td data-l="Scored" className="num">{tot("scored")}</td>
                  <td data-l="Removed" className="num">{rem}</td>
                  <td data-l="LLM $" className="num">{Number(r.llm_cost_usd).toFixed(3)}</td>
                  <td data-l="Errors" className={`num ${r.errors?.length ? "err" : ""}`}>{r.errors?.length ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}
