"use client";

import { useEffect, useState } from "react";
import { formatElapsed, formatSeconds, STATE_META } from "@/lib/format";
import type { AndonState, Leaderboard, MemberTimeStats } from "@/lib/types";

type Member = {
  id: string;
  name: string;
  state: AndonState;
  updated_at: string;
  created_at: string;
};

type Tab = "live" | "today" | "month" | "leaderboard";

const TABS: { id: Tab; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "today", label: "Today" },
  { id: "month", label: "This Month" },
  { id: "leaderboard", label: "Leaderboard" },
];

const STATE_DOT: Record<AndonState, string> = {
  green: "bg-andon-green shadow-[0_0_12px_var(--green)]",
  yellow: "bg-andon-yellow shadow-[0_0_12px_var(--yellow)]",
  red: "bg-andon-red shadow-[0_0_12px_var(--red)]",
};

type StatsPayload = {
  members?: Array<{
    member_id?: string;
    name: string;
    state: AndonState;
    yellow_seconds: number;
    red_seconds: number;
    green_seconds: number;
  }>;
  error?: string;
};

type Props = {
  teamId: string;
  teamName: string;
  members: Member[] | null;
  error: string | null;
  andonConfigured: boolean;
};

export function AnalyticsView({
  teamId,
  teamName,
  members,
  error,
  andonConfigured,
}: Props) {
  const [tab, setTab] = useState<Tab>("live");
  const [now, setNow] = useState(() => Date.now());
  const [stats, setStats] = useState<MemberTimeStats[] | null>(null);
  const [statsFor, setStatsFor] = useState<"today" | "month" | null>(null);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [boardPeriod, setBoardPeriod] = useState<"today" | "month" | null>(null);
  const [period, setPeriod] = useState<"today" | "month">("today");
  const [tabError, setTabError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== "live") return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [tab]);

  useEffect(() => {
    if (tab === "live") return;

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
        } else {
          const path =
            tab === "today"
              ? `/api/stats/today?team_id=${encodeURIComponent(teamId)}`
              : `/api/stats/month?team_id=${encodeURIComponent(teamId)}`;
          const res = await fetch(path, { cache: "no-store" });
          const data = (await res.json()) as StatsPayload;
          if (!res.ok) throw new Error(data.error || "Failed to load stats");
          if (!cancelled) {
            setStats(
              (data.members ?? []).map((member) => ({
                member_id: member.member_id ?? member.name,
                name: member.name,
                state: member.state,
                yellow_seconds: member.yellow_seconds,
                red_seconds: member.red_seconds,
                green_seconds: member.green_seconds,
              })),
            );
            setStatsFor(tab);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setTabError(err instanceof Error ? err.message : "Failed to load");
        }
      }
    }

    load();
    const refresh = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(refresh);
    };
  }, [tab, teamId, period]);

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
              onClick={() => setTab(item.id)}
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
        <LiveBoard members={members} now={now} />
      ) : tab === "leaderboard" ? (
        board && boardPeriod === period ? (
          <LeaderboardPanel board={board} period={period} onPeriod={setPeriod} />
        ) : tabError ? (
          <p className="text-sm text-andon-red">{tabError}</p>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )
      ) : stats && statsFor === tab ? (
        <StatsPanel
          title={tab === "today" ? "Today so far" : "This month"}
          subtitle={
            tab === "today"
              ? "Time in each light, including the current stretch."
              : "Closed history plus whatever is still running."
          }
          stats={stats}
        />
      ) : tabError ? (
        <p className="text-sm text-andon-red">{tabError}</p>
      ) : (
        <p className="text-sm text-muted">Loading…</p>
      )}
    </div>
  );
}

function LiveBoard({ members, now }: { members: Member[] | null; now: number }) {
  if (!members) {
    return <p className="text-sm text-muted">Loading board…</p>;
  }

  if (members.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface px-5 py-10 text-center">
        <p className="text-sm text-muted">No members yet. Share the invite code.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {members.map((member) => {
        const meta = STATE_META[member.state];
        return (
          <li
            key={member.id}
            className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface px-5 py-4"
          >
            <div className="flex min-w-0 items-center gap-4">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATE_DOT[member.state]} ${
                  member.state === "red" ? "animate-[andon-pulse_1.4s_ease-in-out_infinite]" : ""
                }`}
              />
              <div className="min-w-0">
                <p className="truncate font-medium">{member.name}</p>
                <p className="mt-0.5 text-xs tracking-wide text-muted uppercase">
                  {meta.label}
                </p>
              </div>
            </div>
            <span className="font-mono text-sm tabular-nums text-muted">
              {formatElapsed(member.updated_at, now)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function StatsPanel({
  title,
  subtitle,
  stats,
}: {
  title: string;
  subtitle: string;
  stats: MemberTimeStats[] | null;
}) {
  if (!stats || stats.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface px-5 py-10 text-center">
        <p className="text-sm text-muted">No time logged yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </div>
      <ul className="space-y-3">
        {stats.map((member) => (
          <li
            key={member.member_id}
            className="rounded-2xl border border-border bg-surface px-5 py-4"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className={`h-2 w-2 rounded-full ${STATE_DOT[member.state]}`} />
                <span className="font-medium">{member.name}</span>
              </div>
              <span className="text-xs tracking-wide text-muted uppercase">
                {STATE_META[member.state].label}
              </span>
            </div>
            <StackedBar member={member} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function StackedBar({ member }: { member: MemberTimeStats }) {
  const total =
    member.yellow_seconds + member.red_seconds + member.green_seconds || 1;
  const rows: { key: AndonState; seconds: number; className: string }[] = [
    { key: "yellow", seconds: member.yellow_seconds, className: "bg-andon-yellow" },
    { key: "red", seconds: member.red_seconds, className: "bg-andon-red" },
    { key: "green", seconds: member.green_seconds, className: "bg-andon-green" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
        {rows.map((row) =>
          row.seconds > 0 ? (
            <span
              key={row.key}
              className={row.className}
              style={{ width: `${(row.seconds / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        {rows.map((row) => (
          <div key={row.key} className="text-muted">
            <p className="uppercase tracking-wide">{STATE_META[row.key].label}</p>
            <p className="mt-1 font-mono text-foreground tabular-nums">
              {formatSeconds(row.seconds)}
              <span className="ml-1 text-muted">
                {Math.round((row.seconds / total) * 100)}%
              </span>
            </p>
          </div>
        ))}
      </div>
    </div>
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
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          A little petty. A little proud. Completely unofficial.
        </p>
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
              {value === "today" ? "Today" : "This month"}
            </button>
          ))}
        </div>
      </div>

      <Ranking
        title="Waiting champions"
        blurb="Most time stuck on yellow. The official hang-in-there ranking."
        entries={board.waiting}
        metric={(entry) => formatSeconds(entry.yellow_seconds)}
        empty="Nobody waited. Either the floor is on fire or everyone is suspiciously green."
      />
      <Ranking
        title="In the dirt"
        blurb="Yellow plus red — the lights were actually doing something."
        entries={board.working}
        metric={(entry) => formatSeconds(entry.working_seconds)}
        empty="No grind logged. Go on, flip a light."
      />
    </div>
  );
}

function Ranking({
  title,
  blurb,
  entries,
  metric,
  empty,
}: {
  title: string;
  blurb: string;
  entries: Leaderboard["waiting"];
  metric: (entry: Leaderboard["waiting"][number]) => string;
  empty: string;
}) {
  const medals = ["🥇", "🥈", "🥉"];

  if (entries.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-surface px-5 py-8">
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="mt-2 text-sm text-muted">{empty}</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="mt-1 text-sm text-muted">{blurb}</p>
      </div>
      <ol className="overflow-hidden rounded-2xl border border-border bg-surface">
        {entries.map((entry, index) => (
          <li
            key={entry.member_id}
            className="flex items-center justify-between gap-4 border-b border-border px-5 py-3 last:border-b-0"
          >
            <div className="flex items-center gap-3">
              <span className="w-8 text-center text-lg">
                {medals[index] ?? (
                  <span className="font-mono text-sm text-muted">{entry.rank}</span>
                )}
              </span>
              <span className="font-medium">{entry.name}</span>
            </div>
            <span className="font-mono text-sm tabular-nums text-muted">
              {metric(entry)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
