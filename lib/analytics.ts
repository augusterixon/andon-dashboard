import { sql } from "@vercel/postgres";
import { assertTeamExists, ensureSchema } from "@/lib/db";
import type {
  AndonState,
  Leaderboard,
  LeaderboardEntry,
  LeaderboardPeriod,
  MemberTimeStats,
  WorkPrompt,
  WorkSession,
} from "@/lib/types";
import { clusterPrompts } from "@/lib/sessions";

type MemberRow = {
  id: string;
  name: string;
  state: AndonState | null;
  updated_at: Date | string | null;
};

type ClosedRow = {
  member_id: string;
  total_yellow: string | number | bigint;
  total_red: string | number | bigint;
  total_green: string | number | bigint;
  working_sessions: string | number | bigint;
};

type LastWorkingRow = {
  member_id: string;
  last_working_at: Date | string;
};

type SessionRow = {
  id: number;
  member_id: string;
  started_at: Date | string;
  ended_at: Date | string;
  session_id: string | null;
};

type ClosedTotals = {
  yellow: number;
  red: number;
  green: number;
  working_sessions: number;
};

function toSeconds(value: string | number | bigint | null | undefined): number {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
  return { start, end };
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

async function getClosedPeriodStats(
  teamId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<Map<string, ClosedTotals>> {
  const startIso = rangeStart.toISOString();
  const endIso = rangeEnd.toISOString();
  const { rows } = await sql<ClosedRow>`
    SELECT
      sl.member_id,
      COALESCE(SUM(
        CASE WHEN sl.state = 'yellow' THEN
          GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (
            LEAST(sl.ended_at, ${endIso}::timestamptz)
            - GREATEST(sl.started_at, ${startIso}::timestamptz)
          ))))
        ELSE 0 END
      ), 0)::bigint AS total_yellow,
      COALESCE(SUM(
        CASE WHEN sl.state = 'red' THEN
          GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (
            LEAST(sl.ended_at, ${endIso}::timestamptz)
            - GREATEST(sl.started_at, ${startIso}::timestamptz)
          ))))
        ELSE 0 END
      ), 0)::bigint AS total_red,
      COALESCE(SUM(
        CASE WHEN sl.state = 'green' THEN
          GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (
            LEAST(sl.ended_at, ${endIso}::timestamptz)
            - GREATEST(sl.started_at, ${startIso}::timestamptz)
          ))))
        ELSE 0 END
      ), 0)::bigint AS total_green,
      COUNT(*) FILTER (WHERE sl.state = 'yellow')::int AS working_sessions
    FROM state_log sl
    JOIN members m ON m.id = sl.member_id
    WHERE m.team_id = ${teamId}
      AND sl.started_at < ${endIso}::timestamptz
      AND sl.ended_at > ${startIso}::timestamptz
    GROUP BY sl.member_id
  `;

  const closed = new Map<string, ClosedTotals>();
  for (const row of rows) {
    closed.set(row.member_id, {
      yellow: toSeconds(row.total_yellow),
      red: toSeconds(row.total_red),
      green: toSeconds(row.total_green),
      working_sessions: toSeconds(row.working_sessions),
    });
  }
  return closed;
}

async function getLastWorkingAt(teamId: string): Promise<Map<string, string>> {
  const { rows } = await sql<LastWorkingRow>`
    SELECT sl.member_id, MAX(sl.ended_at) AS last_working_at
    FROM state_log sl
    JOIN members m ON m.id = sl.member_id
    WHERE m.team_id = ${teamId}
      AND sl.state = 'yellow'
    GROUP BY sl.member_id
  `;

  const last = new Map<string, string>();
  for (const row of rows) {
    const iso = toIso(row.last_working_at);
    if (iso) last.set(row.member_id, iso);
  }
  return last;
}

function withOpenInterval(
  members: MemberRow[],
  closed: Map<string, ClosedTotals>,
  lastWorking: Map<string, string>,
  rangeStart: Date,
  rangeEnd: Date,
  now = new Date(),
): MemberTimeStats[] {
  return members.map((member) => {
    const totals = {
      yellow: 0,
      red: 0,
      green: 0,
      working_sessions: 0,
      ...(closed.get(member.id) ?? {}),
    };
    const state: AndonState = member.state ?? "green";
    let lastWorkingAt = lastWorking.get(member.id) ?? null;

    if (member.updated_at) {
      const started = new Date(member.updated_at);
      if (!Number.isNaN(started.getTime())) {
        const extra = overlapSeconds(started, now, rangeStart, rangeEnd);
        if (state === "yellow") {
          totals.yellow += extra;
          if (started.getTime() < rangeEnd.getTime() && now.getTime() > rangeStart.getTime()) {
            totals.working_sessions += 1;
          }
          lastWorkingAt = now.toISOString();
        } else if (state === "red") {
          totals.red += extra;
        } else {
          totals.green += extra;
        }
      }
    }

    const workingSessions = totals.working_sessions;
    return {
      member_id: member.id,
      name: member.name,
      state,
      yellow_seconds: totals.yellow,
      red_seconds: totals.red,
      green_seconds: totals.green,
      working_seconds: totals.yellow,
      working_sessions: workingSessions,
      avg_session_seconds:
        workingSessions > 0 ? Math.round(totals.yellow / workingSessions) : 0,
      last_working_at: lastWorkingAt,
      sessions: [],
    };
  });
}

async function getPeriodActivity(
  teamId: string,
  rangeStart: Date,
  rangeEnd: Date,
  now = new Date(),
): Promise<MemberTimeStats[]> {
  const teamMembers = await getTeamMembers(teamId);
  const [closed, lastWorking, sessionsByMember] = await Promise.all([
    getClosedPeriodStats(teamId, rangeStart, rangeEnd),
    getLastWorkingAt(teamId),
    getWorkingSessions(teamId, rangeStart, rangeEnd, teamMembers, now),
  ]);
  const members = withOpenInterval(
    teamMembers,
    closed,
    lastWorking,
    rangeStart,
    rangeEnd,
    now,
  );

  return members.map((member) => {
    const sessions = sessionsByMember.get(member.member_id) ?? [];
    const workingSeconds = sessions.reduce((sum, session) => sum + session.duration_seconds, 0);
    return {
      ...member,
      working_seconds: workingSeconds,
      working_sessions: sessions.length,
      avg_session_seconds:
        sessions.length > 0 ? Math.round(workingSeconds / sessions.length) : 0,
      sessions,
    };
  });
}

export async function getTodayStats(teamId: string): Promise<MemberTimeStats[]> {
  await ensureSchema();
  await assertTeamExists(teamId);

  const { start, end } = utcDayRange();
  return getPeriodActivity(teamId, start, end);
}

export async function getMonthStats(
  teamId: string,
  year: number,
  month: number,
): Promise<MemberTimeStats[]> {
  await ensureSchema();
  await assertTeamExists(teamId);

  const { start, end } = utcMonthRange(year, month);
  return getPeriodActivity(teamId, start, end);
}

async function getWorkingSessions(
  teamId: string,
  rangeStart: Date,
  rangeEnd: Date,
  members: MemberRow[],
  now = new Date(),
): Promise<Map<string, WorkSession[]>> {
  const { rows } = await sql<SessionRow>`
    SELECT sl.id, sl.member_id, sl.started_at, sl.ended_at, sl.session_id
    FROM state_log sl
    JOIN members m ON m.id = sl.member_id
    WHERE m.team_id = ${teamId}
      AND sl.state = 'yellow'
    ORDER BY sl.started_at ASC, sl.id ASC
  `;

  const byMember = new Map<string, SessionRow[]>();
  for (const row of rows) {
    const list = byMember.get(row.member_id) ?? [];
    list.push(row);
    byMember.set(row.member_id, list);
  }

  const openId = -1;
  const result = new Map<string, WorkSession[]>();

  for (const member of members) {
    const closed = byMember.get(member.id) ?? [];
    const prompts = closed.map((row) => ({
      id: row.id,
      startedAt: new Date(row.started_at).getTime(),
      endedAt: new Date(row.ended_at).getTime(),
      startedIso: toIso(row.started_at) ?? new Date(row.started_at).toISOString(),
      endedIso: toIso(row.ended_at),
    }));

    if ((member.state ?? "green") === "yellow" && member.updated_at) {
      const started = new Date(member.updated_at).getTime();
      if (!Number.isNaN(started) && started < rangeEnd.getTime() && now.getTime() > rangeStart.getTime()) {
        prompts.push({
          id: openId,
          startedAt: started,
          endedAt: now.getTime(),
          startedIso: new Date(started).toISOString(),
          endedIso: null,
        });
      }
    }

    const clusters = clusterPrompts(
      prompts.map((prompt) => ({
        id: prompt.id,
        startedAt: prompt.startedAt,
        endedAt: prompt.endedAt,
      })),
    );
    const promptById = new Map(prompts.map((prompt) => [prompt.id, prompt]));
    const sessions: WorkSession[] = [];

    for (const cluster of clusters) {
      const clusterPromptsList = cluster.promptIds
        .map((id) => promptById.get(id))
        .filter((prompt): prompt is (typeof prompts)[number] => Boolean(prompt));
      const overlapping = clusterPromptsList.filter(
        (prompt) => prompt.startedAt < rangeEnd.getTime() && prompt.endedAt > rangeStart.getTime(),
      );
      if (overlapping.length === 0) continue;

      const startedMs = Math.max(cluster.startedAt, rangeStart.getTime());
      const endedMs = Math.min(cluster.endedAt, rangeEnd.getTime());
      const last = overlapping[overlapping.length - 1];
      const isOpen = last?.id === openId;
      const duration = overlapSeconds(
        new Date(cluster.startedAt),
        new Date(cluster.endedAt),
        rangeStart,
        rangeEnd,
      );
      if (duration <= 0) continue;

      const workPrompts: WorkPrompt[] = overlapping.map((prompt) => ({
        started_at: prompt.startedIso,
        ended_at: prompt.id === openId ? null : prompt.endedIso,
      }));

      sessions.push({
        session_id: cluster.sessionId,
        started_at: new Date(startedMs).toISOString(),
        ended_at: isOpen ? null : new Date(endedMs).toISOString(),
        duration_seconds: duration,
        prompt_count: workPrompts.length,
        prompts: workPrompts,
      });
    }

    result.set(member.id, sessions);
  }

  return result;
}

function rankByWorking(members: MemberTimeStats[]): LeaderboardEntry[] {
  return [...members]
    .filter((member) => member.working_sessions > 0)
    .sort(
      (a, b) =>
        b.working_seconds - a.working_seconds || a.name.localeCompare(b.name),
    )
    .map((member, index) => ({
      rank: index + 1,
      member_id: member.member_id,
      name: member.name,
      state: member.state,
      working_seconds: member.working_seconds,
      working_sessions: member.working_sessions,
      avg_session_seconds: member.avg_session_seconds,
      sessions: member.sessions,
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
    entries: rankByWorking(members),
  };
}

export function isLeaderboardPeriod(value: string | null): value is LeaderboardPeriod {
  return value === "today" || value === "month";
}

export function serializeMemberStats(member: MemberTimeStats) {
  return {
    member_id: member.member_id,
    name: member.name,
    state: member.state,
    yellow_seconds: member.yellow_seconds,
    red_seconds: member.red_seconds,
    green_seconds: member.green_seconds,
    working_seconds: member.working_seconds,
    working_sessions: member.working_sessions,
    avg_session_seconds: member.avg_session_seconds,
    last_working_at: member.last_working_at,
    sessions: member.sessions,
  };
}
