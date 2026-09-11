import Link from "next/link";
import { DashboardClient } from "@/components/DashboardClient";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ team_id?: string | string[] }>;
}) {
  const params = await searchParams;
  const teamId = typeof params.team_id === "string" ? params.team_id : "";

  if (!teamId) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Missing team_id. Create or join a team first.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm text-zinc-200 underline-offset-2 hover:underline"
        >
          Go home
        </Link>
      </div>
    );
  }

  return <DashboardClient teamId={teamId} />;
}
