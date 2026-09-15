import { sql } from "@vercel/postgres";
import { assertTeamExists, ensureSchema } from "@/lib/db";
import type {
  AndonState,
  Leaderboard,
  LeaderboardEntry,
  LeaderboardPeriod,
  MemberTimeStats,
} from "@/lib/types";

type MemberRow = {
  id: string;
  name: string;
  state: AndonState | null;
  updated_at: Date | string | null;
};

type StatsRow = {
  member_id: string;
  total_yellow: string | number | bigint;
  total_red: string | number | bigint;
  total_green: string | number | bigint;
};

function toSeconds(value: string | number | bigint | null | undefined): number {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function overlapSeconds(
  startedAt: Date,
  endedAt: Date,
  rangeStart: Date,
  rangeEnd: Date,
): number {
  const from = Math.max(startedAt.getTime(), rangeStart.getTime());
  const to = Math.min(endedAt.getTime(), rangeEnd.getTime());
  return Math.max(0, Math.floor((to - from) / 1000));
}

function utcDayRange(now = new Date()) {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, day: start.toISOString().slice(0, 10) };
}

function utcMonthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}

async function getTeamMembers(teamId: string): Promise<MemberRow[]> {
  const { rows } = await sql<MemberRow>`
    SELECT
      m.id,
      m.name,
      cs.state,
      cs.updated_at
    FROM members m
    LEFT JOIN current_state cs ON cs.member_id = m.id
    WHERE m.team_id = ${teamId}
    ORDER BY m.created_at ASC
  `;
  return rows;
}

function withOpenInterval(
  members: MemberRow[],
  closed: Map<string, { yellow: number; red: number; green: number }>,
  rangeStart: Date,
  rangeEnd: Date,
  now = new Date(),
): MemberTimeStats[] {
  return members.map((member) => {
    const totals = closed.get(member.id) ?? { yellow: 0, red: 0, green: 0 };
    const state: AndonState = member.state ?? "green";
    if (member.updated_at) {
      const started = new Date(member.updated_at);
      if (!Number.isNaN(started.getTime())) {
        const extra = overlapSeconds(started, now, rangeStart, rangeEnd);
        if (state === "yellow") totals.yellow += extra;
        else if (state === "red") totals.red += extra;
        else totals.green += extra;
      }
    }

    return {
      member_id: member.id,
      name: member.name,
      state,
      yellow_seconds: totals.yellow,
      red_seconds: totals.red,
      green_seconds: totals.green,
    };
  });
}

function toClosedMap(rows: StatsRow[]) {
  const closed = new Map<string, { yellow: number; red: number; green: number }>();
  for (const row of rows) {
    closed.set(row.member_id, {
      yellow: toSeconds(row.total_yellow),
      red: toSeconds(row.total_red),
      green: toSeconds(row.total_green),
    });
  }
  return closed;
}

export async function getTodayStats(teamId: string): Promise<MemberTimeStats[]> {
  await ensureSchema();
  await assertTeamExists(teamId);

  const { start, end, day } = utcDayRange();
  const members = await getTeamMembers(teamId);
  const { rows } = await sql<StatsRow>`
    SELECT member_id, total_yellow, total_red, total_green
    FROM daily_stats
    WHERE team_id = ${teamId} AND day = ${day}::date
  `;

  return withOpenInterval(members, toClosedMap(rows), start, end);
}

export async function getMonthStats(
  teamId: string,
  year: number,
  month: number,
): Promise<MemberTimeStats[]> {
  await ensureSchema();
  await assertTeamExists(teamId);

  const { start, end } = utcMonthRange(year, month);
  const members = await getTeamMembers(teamId);
  const { rows } = await sql<StatsRow>`
    SELECT member_id, total_yellow, total_red, total_green
    FROM monthly_stats
    WHERE team_id = ${teamId} AND year = ${year} AND month = ${month}
  `;

  return withOpenInterval(members, toClosedMap(rows), start, end);
}

function rankBy(
  members: MemberTimeStats[],
  score: (member: MemberTimeStats) => number,
): LeaderboardEntry[] {
  return [...members]
    .map((member) => ({
      member_id: member.member_id,
      name: member.name,
      yellow_seconds: member.yellow_seconds,
      red_seconds: member.red_seconds,
      green_seconds: member.green_seconds,
      working_seconds: member.yellow_seconds + member.red_seconds,
      score: score(member),
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((member, index) => ({
      rank: index + 1,
      member_id: member.member_id,
      name: member.name,
      yellow_seconds: member.yellow_seconds,
      red_seconds: member.red_seconds,
      green_seconds: member.green_seconds,
      working_seconds: member.working_seconds,
    }));
}

export async function getLeaderboard(
  teamId: string,
  period: LeaderboardPeriod,
  now = new Date(),
): Promise<Leaderboard> {
  const members =
    period === "today"
      ? await getTodayStats(teamId)
      : await getMonthStats(teamId, now.getUTCFullYear(), now.getUTCMonth() + 1);

  return {
    period,
    waiting: rankBy(members, (member) => member.yellow_seconds),
    working: rankBy(members, (member) => member.yellow_seconds + member.red_seconds),
  };
}

export function isLeaderboardPeriod(value: string | null): value is LeaderboardPeriod {
  return value === "today" || value === "month";
}
