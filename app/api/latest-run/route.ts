// Progress polling for the "Refresh now" button.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data } = await db()
    .from("runs")
    .select("id,status,stage,started_at,finished_at")
    .order("started_at", { ascending: false })
    .limit(1);
  return NextResponse.json(data?.[0] ?? null, { headers: { "Cache-Control": "no-store" } });
}
