"use client";

import { useEffect, useState } from "react";

type AndonState = "green" | "yellow" | "red";

type Member = {
  id: string;
  name: string;
  state: AndonState;
  updated_at: string;
  created_at: string;
};

type StatusResponse = {
  team?: { id: string; name: string; invite_code: string };
  members?: Member[];
  error?: string;
};

const STATE_EMOJI: Record<AndonState, string> = {
  green: "🟢",
  yellow: "🟡",
  red: "🔴",
};

function formatTimeInState(updatedAt: string) {
  const started = new Date(updatedAt).getTime();
  if (Number.isNaN(started)) return "";

  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

export function DashboardClient({ teamId }: { teamId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(
          `/api/team/status?team_id=${encodeURIComponent(teamId)}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as StatusResponse;
        if (!res.ok) {
          throw new Error(data.error || "Failed to fetch team status");
        }
        if (cancelled) return;
        setMembers(Array.isArray(data.members) ? data.members : []);
        setTeamName(data.team?.name ?? "Team");
        setError(null);
        setNow(Date.now());
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to fetch");
        }
      }
    }

    poll();
    const interval = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [teamId]);

  if (error && !members) {
    return <p className="text-sm text-red-400">Error: {error}</p>;
  }

  if (!members) {
    return <p className="text-sm text-zinc-500">Loading board…</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{teamName || "Team Status"}</h1>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {members.length === 0 ? (
        <p className="text-sm text-zinc-500">No members yet</p>
      ) : (
        <ul className="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <span className="font-medium">
                {STATE_EMOJI[member.state] ?? "🟢"} {member.name}
              </span>
              {member.state !== "green" && (
  <span className="font-mono text-xs text-zinc-500">
    {formatTimeInState(member.updated_at)}
  </span>
)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
