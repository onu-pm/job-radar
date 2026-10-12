"use server";
// Server actions. They run behind the password proxy like every other request.
import { revalidatePath } from "next/cache";
import { db, must } from "@/lib/db";

export async function setStatus(jobId: string, status: "new" | "applied" | "skip") {
  if (!["new", "applied", "skip"].includes(status)) throw new Error("bad status");
  must(
    await db().from("job_status").upsert({ job_id: jobId, status, updated_at: new Date().toISOString() }),
    "save status",
  );
}

export async function setIncludeIndiaOnsite(on: boolean) {
  must(await db().from("settings").upsert({ key: "include_india_onsite", value: on }), "save setting");
  // Apply right away for roles already triaged; the next refresh scores any newly included ones.
  if (on) {
    await db().from("jobs").update({ state: "active", filter_reason: null }).eq("state", "filtered").eq("filter_reason", "india_onsite");
  } else {
    await db().from("jobs").update({ state: "filtered", filter_reason: "india_onsite" }).eq("state", "active").eq("location_result", "india_onsite");
  }
  revalidatePath("/");
}

/** Starts the GitHub Actions workflow (workflow_dispatch). */
export async function triggerRefresh(): Promise<{ ok: boolean; message: string }> {
  const running = must<any[]>(
    await db()
      .from("runs")
      .select("id,started_at")
      .eq("status", "running")
      .gte("started_at", new Date(Date.now() - 20 * 60e3).toISOString())
      .limit(1),
    "runs",
  );
  if (running.length) return { ok: true, message: "A refresh is already running." };

  const repo = process.env.GITHUB_REPO;
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!repo || !token) return { ok: false, message: "Refresh isn't set up yet (GITHUB_REPO / GH_DISPATCH_TOKEN missing)." };
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/radar.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: "main", inputs: { trigger: "manual" } }),
  });
  if (res.status === 204) return { ok: true, message: "Refresh started. It usually takes 2–5 minutes." };
  return { ok: false, message: `GitHub said ${res.status}: ${(await res.text()).slice(0, 200)}` };
}
