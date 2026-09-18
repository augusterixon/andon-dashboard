"use client";

import { useEffect, useState } from "react";
import { AndonInviteCta } from "@/components/AndonInviteCta";
import { TeamInviteShare } from "@/components/TeamInviteShare";
import {
  formatClock,
  formatSeconds,
  formatSessionLine,
  formatWorkingSummary,
  STATE_META,
} from "@/lib/format";
import type {
  AndonState,
  Leaderboard,
  LeaderboardEntry,
  MemberTimeStats,
  WorkSession,
} from "@/lib/types";

type Member = {
  id: string;
  name: string;
  state: AndonState;
  updated_at: string;
  created_at: string;
};

type Tab = "live" | "leaderboard" | "invite";

const TAB_STORAGE_KEY = "andon.dashboardTab";

const TABS: { id: Tab; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "leaderboard", label: "Leaderboard" },
  { id: "invite", label: "Invite" },
];

const STATE_DOT: Record<AndonState, string> = {
  green: "bg-andon-green shadow-[0_0_12px_var(--green)]",
  yellow: "bg-andon-yellow shadow-[0_0_12px_var(--yellow)]",
  red: "bg-andon-red shadow-[0_0_12px_var(--red)]",
};

const CARD_HOVER =
  "cursor-pointer transition duration-200 hover:border-accent/40 hover:bg-surface-2 hover:shadow-[0_0_28px_rgba(232,195,106,0.12)] focus-visible:border-accent/40 focus-visible:bg-surface-2 focus-visible:outline-none";

type StatsPayload = {
  members?: Array<{
    member_id?: string;
    name: string;
    state: AndonState;
    yellow_seconds: number;
    red_seconds: number;
    green_seconds: number;
    working_seconds?: number;
    working_sessions?: number;
    avg_session_seconds?: number;
    last_working_at?: string | null;
    sessions?: Array<{
      session_id?: string;
      started_at: string;
      ended_at: string | null;
      duration_seconds: number;
      prompt_count?: number;
      prompts?: WorkSession["prompts"];
    }>;
  }>;
  error?: string;
};

type Props = {
  teamId: string;
  teamName: string;
  inviteCode: string;
  members: Member[] | null;
  error: string | null;
  andonConfigured: boolean;
};

function readStoredTab(): Tab {
  if (typeof window === "undefined") return "live";
  try {
    const value = window.localStorage.getItem(TAB_STORAGE_KEY);
    if (value === "live") return "live";
    if (value === "invite") return "invite";
    if (value === "leaderboard" || value === "today" || value === "month") {
      return "leaderboard";
    }
    return "live";
  } catch {
    return "live";
  }
}

function toMemberStats(member: NonNullable<StatsPayload["members"]>[number]): MemberTimeStats {
  const sessions = (member.sessions ?? []).map((session) => ({
    session_id: session.session_id ?? `${session.started_at}`,
    started_at: session.started_at,
    ended_at: session.ended_at ?? null,
    duration_seconds: session.duration_seconds,
    prompt_count: session.prompt_count ?? session.prompts?.length ?? 1,
    prompts: session.prompts ?? [],
  }));
  const workingSeconds = member.working_seconds ?? member.yellow_seconds;
  return {
    member_id: member.member_id ?? member.name,
    name: member.name,
    state: member.state,
    yellow_seconds: member.yellow_seconds,
    red_seconds: member.red_seconds,
    green_seconds: member.green_seconds,
    working_seconds: workingSeconds,
    working_sessions: member.working_sessions ?? sessions.length,
    avg_session_seconds: member.avg_session_seconds ?? 0,
    last_working_at: member.last_working_at ?? null,
    sessions,
  };
}

export function AnalyticsView({
  teamId,
  teamName,
  inviteCode,
  members,
  error,
  andonConfigured,
}: Props) {
  const [tab, setTab] = useState<Tab>("live");
  const [tabReady, setTabReady] = useState(false);
  const [todayStats, setTodayStats] = useState<MemberTimeStats[] | null>(null);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [boardPeriod, setBoardPeriod] = useState<"today" | "month" | null>(null);
  const [period, setPeriod] = useState<"today" | "month">("today");
  const [tabError, setTabError] = useState<string | null>(null);

  useEffect(() => {
    setTab(readStoredTab());
    setTabReady(true);
  }, []);

  useEffect(() => {
    if (!tabReady) return;
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      // Ignore quota / private-mode failures.
    }
  }, [tab, tabReady]);

  function selectTab(next: Tab) {
    if (next === "leaderboard") setPeriod("today");
    setTab(next);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setTabError(null);
      try {
        if (tab === "leaderboard") {
          const res = await fetch(
            `/api/leaderboard?team_id=${encodeURIComponent(teamId)}&period=${period}`,
            { cache: "no-store" },
          );
          const data = (await res.json()) as Leaderboard & { error?: string };
          if (!res.ok) throw new Error(data.error || "Failed to load leaderboard");
          if (!cancelled) {
            setBoard(data);
            setBoardPeriod(period);
          }
          return;
        }

        const res = await fetch(
          `/api/stats/today?team_id=${encodeURIComponent(teamId)}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as StatsPayload;
        if (!res.ok) throw new Error(data.error || "Failed to load stats");
        if (!cancelled) {
          setTodayStats((data.members ?? []).map(toMemberStats));
        }
      } catch (err) {
        if (!cancelled) {
          setTabError(err instanceof Error ? err.message : "Failed to load");
        }
      }
    }

    if (tab === "invite") return;

    load();
    const refresh = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(refresh);
    };
  }, [tab, teamId, period]);

  const todayById = new Map(todayStats?.map((row) => [row.member_id, row]) ?? []);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <p className="text-xs font-medium tracking-[0.18em] text-muted uppercase">
          Team board
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            {teamName || "Team status"}
          </h1>
          {andonConfigured ? (
            <p className="rounded-full border border-andon-green/30 bg-andon-green/10 px-3 py-1 text-xs text-andon-green">
              Andon is tracking this team
            </p>
          ) : null}
        </div>
      </div>

      <div
        role="tablist"
        className="flex gap-1 rounded-full border border-border bg-surface p-1"
      >
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(item.id)}
              className={`flex-1 rounded-full px-3 py-2 text-sm transition ${
                active
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {error ? <p className="text-sm text-andon-red">Error: {error}</p> : null}

      {tab === "live" ? (
        <LiveBoard members={members} todayById={todayById} />
      ) : tab === "invite" ? (
        <InvitePanel
          inviteCode={inviteCode}
          teamId={teamId}
          teamName={teamName || "Team"}
        />
      ) : board && boardPeriod === period ? (
        <LeaderboardPanel board={board} period={period} onPeriod={setPeriod} />
      ) : tabError ? (
        <p className="text-sm text-andon-red">{tabError}</p>
      ) : (
        <p className="text-sm text-muted">Loading…</p>
      )}
    </div>
  );
}

function InvitePanel({
  inviteCode,
  teamId,
  teamName,
}: {
  inviteCode: string;
  teamId: string;
  teamName: string;
}) {
  if (!inviteCode) {
    return <p className="text-sm text-muted">Loading invite…</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Invite</h2>
        <p className="mt-1 text-sm text-muted">
          Share the code or link so others can join this team.
        </p>
      </div>
      <TeamInviteShare
        inviteCode={inviteCode}
        teamId={teamId}
        teamName={teamName}
      />
      <AndonInviteCta
        inviteCode={inviteCode}
        teamId={teamId}
        teamName={teamName}
      />
    </div>
  );
}

function SessionHover({ sessions }: { sessions: WorkSession[] }) {
  return (
    <ol className="mt-3 hidden max-h-64 space-y-2 overflow-y-auto border-t border-border pt-3 text-xs text-muted group-hover:block group-focus-within:block">
      {sessions.length === 0 ? (
        <li>No working sessions</li>
      ) : (
        sessions.map((session, sessionIndex) => (
          <li key={session.session_id || `${session.started_at}-${sessionIndex}`}>
            <p>
              {formatSessionLine(
                sessionIndex + 1,
                session.duration_seconds,
                session.started_at,
                session.ended_at,
                session.prompt_count,
              )}
            </p>
            {session.prompts.length > 0 ? (
              <ol className="mt-1 space-y-0.5 pl-3">
                {session.prompts.map((prompt, promptIndex) => (
                  <li key={`${prompt.started_at}-${promptIndex}`}>
                    Prompt {promptIndex + 1}: {formatClock(prompt.started_at)}
                    {prompt.ended_at
                      ? ` (${formatSeconds(
                          Math.max(
                            0,
                            Math.floor(
                              (new Date(prompt.ended_at).getTime() -
                                new Date(prompt.started_at).getTime()) /
                                1000,
                            ),
                          ),
                        )})`
                      : " (in progress)"}
                  </li>
                ))}
              </ol>
            ) : null}
          </li>
        ))
      )}
    </ol>
  );
}

function LiveBoard({
  members,
  todayById,
}: {
  members: Member[] | null;
  todayById: Map<string, MemberTimeStats>;
}) {
  if (!members) {
    return <p className="text-sm text-muted">Loading board…</p>;
  }

  if (members.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface px-5 py-10 text-center">
        <p className="text-sm text-muted">No members yet. Share the invite from the Invite tab.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {members.map((member) => {
        const meta = STATE_META[member.state];
        const today = todayById.get(member.id);
        return (
          <li
            key={member.id}
            tabIndex={0}
            className={`group rounded-2xl border border-border bg-surface px-5 py-4 ${CARD_HOVER}`}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-4">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATE_DOT[member.state]} ${
                    member.state === "red" ? "animate-[andon-pulse_1.4s_ease-in-out_infinite]" : ""
                  }`}
                />
                <p className="truncate font-medium">{member.name}</p>
              </div>
              <p className="shrink-0 text-sm text-muted">
                Currently: {meta.label}
                <span className="ml-2 font-mono tabular-nums text-foreground/80">
                  {formatClock(member.updated_at)}
                </span>
              </p>
            </div>
            <SessionHover sessions={today?.sessions ?? []} />
          </li>
        );
      })}
    </ul>
  );
}

function LeaderboardRow({
  name,
  seconds,
  sessions,
  isFirst,
}: {
  name: string;
  seconds: number;
  sessions: WorkSession[];
  isFirst: boolean;
}) {
  return (
    <li tabIndex={0} className={`group rounded-2xl border border-border bg-surface px-5 py-4 ${CARD_HOVER}`}>
      <p className="min-w-0 truncate text-sm text-foreground sm:text-[15px]">
        {isFirst ? <span className="mr-1">🥇</span> : null}
        <span className="font-medium">{name}</span>
        <span className="text-muted">{"  |  "}</span>
        <span className="font-mono tabular-nums text-muted">
          {formatWorkingSummary(seconds, sessions.length)}
        </span>
      </p>
      <SessionHover sessions={sessions} />
    </li>
  );
}

function LeaderboardPanel({
  board,
  period,
  onPeriod,
}: {
  board: Leaderboard | null;
  period: "today" | "month";
  onPeriod: (period: "today" | "month") => void;
}) {
  if (!board) {
    return <p className="text-sm text-muted">No ranking yet.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Leaderboard</h2>
          <p className="mt-1 text-sm text-muted">Sorted by total working time.</p>
        </div>
        <div className="flex rounded-full border border-border p-1">
          {(["today", "month"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onPeriod(value)}
              className={`rounded-full px-3 py-1 text-xs ${
                period === value
                  ? "bg-foreground text-background"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {value === "today" ? "Today" : "This Month"}
            </button>
          ))}
        </div>
      </div>

      {board.entries.length === 0 ? (
        <section className="rounded-2xl border border-border bg-surface px-5 py-8">
          <p className="text-sm text-muted">No coding sessions yet. Flip a light and get going.</p>
        </section>
      ) : (
        <ul className="space-y-3">
          {board.entries.map((entry: LeaderboardEntry, index) => (
            <LeaderboardRow
              key={entry.member_id}
              name={entry.name}
              seconds={entry.working_seconds}
              sessions={entry.sessions}
              isFirst={index === 0}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
