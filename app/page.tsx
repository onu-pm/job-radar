import { loadDashboard } from "@/lib/data";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await loadDashboard();
  return <Dashboard {...data} serverNow={Date.now()} />;
}
