"use client";

import { useEffect, useState } from "react";
import { AnalyticsView } from "@/components/AnalyticsView";
import { consumeAndonConfiguredFlash } from "@/lib/andon-local";
import type { AndonState } from "@/lib/types";

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

export function DashboardClient({ teamId }: { teamId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [teamName, setTeamName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [andonConfigured, setAndonConfigured] = useState(() =>
    consumeAndonConfiguredFlash(),
  );

  useEffect(() => {
    if (!andonConfigured) return;
    const hide = window.setTimeout(() => setAndonConfigured(false), 4000);
    return () => window.clearTimeout(hide);
  }, [andonConfigured]);

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
        setInviteCode(data.team?.invite_code ?? "");
        setError(null);
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
    return <p className="text-sm text-andon-red">Error: {error}</p>;
  }

  return (
    <AnalyticsView
      teamId={teamId}
      teamName={teamName}
      inviteCode={inviteCode}
      members={members}
      error={error}
      andonConfigured={andonConfigured}
    />
  );
}
