import { sql } from "@vercel/postgres";
import { HttpError } from "@/lib/http";
import {
  generateAuthToken,
  generateInviteCode,
  generateMemberName,
  normalizeInviteCode,
} from "@/lib/ids";
import { backfillSessionIds, refreshMemberSessionIds } from "@/lib/sessions";
import type { AndonState, MemberStatus, TeamStatus } from "@/lib/types";

let schemaReady = false;

function requireDatabaseUrl() {
  if (!process.env.POSTGRES_URL) {
    throw new HttpError(
      500,
      "POSTGRES_URL is not set. Add a Vercel Postgres database or a local connection string.",
    );
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

export async function ensureSchema() {
  if (schemaReady) return;
  requireDatabaseUrl();

  await sql`
    CREATE TABLE IF NOT EXISTS teams (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      invite_code VARCHAR(8) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      auth_token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS current_state (
      member_id UUID PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      state TEXT NOT NULL CHECK (state IN ('green', 'yellow', 'red')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS state_log (
      id SERIAL PRIMARY KEY,
      member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      state TEXT NOT NULL CHECK (state IN ('green', 'yellow', 'red')),
      started_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      duration_seconds INTEGER NOT NULL,
      session_id UUID
    )
  `;

  await sql`ALTER TABLE state_log ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`;
  await sql`
    UPDATE state_log
    SET started_at = ended_at - (duration_seconds * INTERVAL '1 second')
    WHERE started_at IS NULL
  `;
  await sql`ALTER TABLE state_log ALTER COLUMN started_at SET DEFAULT NOW()`;
  await sql`ALTER TABLE state_log ALTER COLUMN started_at SET NOT NULL`;
  await sql`ALTER TABLE state_log ADD COLUMN IF NOT EXISTS session_id UUID`;

  await sql`CREATE INDEX IF NOT EXISTS members_team_id_idx ON members (team_id)`;
  await sql`CREATE INDEX IF NOT EXISTS state_log_member_id_idx ON state_log (member_id)`;
  await sql`CREATE INDEX IF NOT EXISTS state_log_started_at_idx ON state_log (started_at)`;
  await sql`CREATE INDEX IF NOT EXISTS state_log_ended_at_idx ON state_log (ended_at)`;
  await sql`CREATE INDEX IF NOT EXISTS state_log_session_id_idx ON state_log (session_id)`;

  await sql`DROP VIEW IF EXISTS monthly_stats`;
  await sql`DROP VIEW IF EXISTS daily_stats`;

  await sql`
    CREATE VIEW daily_stats AS
    SELECT
      m.id AS member_id,
      m.team_id,
      m.name AS member_name,
      d.day,
      COALESCE(SUM(d.yellow_seconds), 0)::bigint AS total_yellow,
      COALESCE(SUM(d.red_seconds), 0)::bigint AS total_red,
      COALESCE(SUM(d.green_seconds), 0)::bigint AS total_green
    FROM members m
    JOIN (
      SELECT
        sl.member_id,
        gs::date AS day,
        CASE WHEN sl.state = 'yellow' THEN clipped.seconds ELSE 0 END AS yellow_seconds,
        CASE WHEN sl.state = 'red' THEN clipped.seconds ELSE 0 END AS red_seconds,
        CASE WHEN sl.state = 'green' THEN clipped.seconds ELSE 0 END AS green_seconds
      FROM state_log sl
      CROSS JOIN LATERAL generate_series(
        (sl.started_at AT TIME ZONE 'UTC')::date,
        (sl.ended_at AT TIME ZONE 'UTC')::date,
        INTERVAL '1 day'
      ) AS gs
      CROSS JOIN LATERAL (
        SELECT GREATEST(
          0,
          FLOOR(EXTRACT(EPOCH FROM (
            LEAST(sl.ended_at, ((gs::date + 1) AT TIME ZONE 'UTC'))
            - GREATEST(sl.started_at, (gs::date AT TIME ZONE 'UTC'))
          )))
        )::int AS seconds
      ) clipped
    ) d ON d.member_id = m.id
    GROUP BY m.id, m.team_id, m.name, d.day
  `;

  await sql`
    CREATE VIEW monthly_stats AS
    SELECT
      member_id,
      team_id,
      member_name,
      EXTRACT(YEAR FROM day)::int AS year,
      EXTRACT(MONTH FROM day)::int AS month,
      SUM(total_yellow)::bigint AS total_yellow,
      SUM(total_red)::bigint AS total_red,
      SUM(total_green)::bigint AS total_green
    FROM daily_stats
    GROUP BY member_id, team_id, member_name, EXTRACT(YEAR FROM day), EXTRACT(MONTH FROM day)
  `;

  await backfillSessionIds();

  schemaReady = true;
}

export async function createTeam(name: string) {
  await ensureSchema();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = generateInviteCode();
    try {
      const { rows } = await sql<{
        id: string;
        invite_code: string;
      }>`
        INSERT INTO teams (name, invite_code)
        VALUES (${name}, ${inviteCode})
        RETURNING id, invite_code
      `;
      return rows[0];
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }

  throw new HttpError(500, "Could not generate a unique invite code");
}

export async function joinTeam(inviteCode: string, name?: string) {
  await ensureSchema();

  const code = normalizeInviteCode(inviteCode);
  if (code.length !== 8) {
    throw new HttpError(400, "Invite code must be 8 characters");
  }

  const { rows: teams } = await sql<{ id: string; name: string }>`
    SELECT id, name FROM teams WHERE invite_code = ${code}
  `;

  const team = teams[0];
  if (!team) {
    throw new HttpError(404, "Invite code not found");
  }

  const memberName = name?.trim() || generateMemberName();
  const authToken = generateAuthToken();

  const { rows: members } = await sql<{
    id: string;
    team_id: string;
    name: string;
    auth_token: string;
  }>`
    INSERT INTO members (team_id, name, auth_token)
    VALUES (${team.id}, ${memberName}, ${authToken})
    RETURNING id, team_id, name, auth_token
  `;

  const member = members[0];

  await sql`
    INSERT INTO current_state (member_id, state)
    VALUES (${member.id}, 'green')
  `;

  return {
    team_id: member.team_id,
    member_id: member.id,
    auth_token: member.auth_token,
    member_name: member.name,
    team_name: team.name,
  };
}

export async function assertTeamExists(teamId: string) {
  await ensureSchema();

  const { rows } = await sql<{ id: string }>`
    SELECT id FROM teams WHERE id = ${teamId}
  `;

  if (!rows[0]) {
    throw new HttpError(404, "Team not found");
  }
}

export async function updateMemberState(input: {
  teamId: string;
  memberId: string;
  state: AndonState;
  authToken: string;
  timestamp?: Date;
}) {
  await ensureSchema();

  const { rows: members } = await sql<{ id: string }>`
    SELECT id
    FROM members
    WHERE id = ${input.memberId}
      AND team_id = ${input.teamId}
      AND auth_token = ${input.authToken}
  `;

  if (!members[0]) {
    throw new HttpError(401, "Invalid auth token or member");
  }

  const { rows: current } = await sql<{
    state: AndonState;
    updated_at: Date | string;
  }>`
    SELECT state, updated_at
    FROM current_state
    WHERE member_id = ${input.memberId}
  `;

  const currentRow = current[0];
  const endedAt = input.timestamp ?? new Date();
  const endedAtIso = endedAt.toISOString();

  if (!currentRow) {
    await sql`
      INSERT INTO current_state (member_id, state, updated_at)
      VALUES (${input.memberId}, ${input.state}, ${endedAtIso})
    `;
    return;
  }

  if (currentRow.state === input.state) {
    return;
  }

  const startedAt = new Date(currentRow.updated_at);
  const startedMs = startedAt.getTime();
  const startedAtIso = Number.isNaN(startedMs)
    ? endedAtIso
    : startedAt.toISOString();
  const durationSeconds = Number.isNaN(startedMs)
    ? 0
    : Math.max(0, Math.floor((endedAt.getTime() - startedMs) / 1000));

  await sql`
    INSERT INTO state_log (member_id, state, started_at, ended_at, duration_seconds)
    VALUES (
      ${input.memberId},
      ${currentRow.state},
      ${startedAtIso},
      ${endedAtIso},
      ${durationSeconds}
    )
  `;

  await refreshMemberSessionIds(input.memberId);

  await sql`
    UPDATE current_state
    SET state = ${input.state}, updated_at = ${endedAtIso}
    WHERE member_id = ${input.memberId}
  `;
}

export async function getTeamStatus(teamId: string): Promise<TeamStatus> {
  await ensureSchema();

  const { rows: teams } = await sql<{
    id: string;
    name: string;
    invite_code: string;
  }>`
    SELECT id, name, invite_code
    FROM teams
    WHERE id = ${teamId}
  `;

  const team = teams[0];
  if (!team) {
    throw new HttpError(404, "Team not found");
  }

  const { rows } = await sql<{
    id: string;
    name: string;
    created_at: Date | string;
    state: AndonState | null;
    updated_at: Date | string | null;
  }>`
    SELECT
      m.id,
      m.name,
      m.created_at,
      cs.state,
      cs.updated_at
    FROM members m
    LEFT JOIN current_state cs ON cs.member_id = m.id
    WHERE m.team_id = ${teamId}
    ORDER BY m.created_at ASC
  `;

  const members: MemberStatus[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    state: row.state ?? "green",
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at ?? row.created_at),
  }));

  return {
    team: {
      id: team.id,
      name: team.name,
      invite_code: team.invite_code,
    },
    members,
  };
}
