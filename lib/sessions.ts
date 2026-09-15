import { randomUUID } from "crypto";
import { sql } from "@vercel/postgres";
import type { AndonState } from "@/lib/types";

export const SESSION_INACTIVITY_MS = 15 * 60 * 1000;
export const SESSION_GROUPING_MIGRATION = "002_session_grouping";

export type PromptLike = {
  id: number;
  startedAt: number;
  endedAt: number;
};

export type SessionCluster = {
  sessionId: string;
  promptIds: number[];
  startedAt: number;
  endedAt: number;
};

type StateChangeLike = PromptLike & {
  lastStartedAt?: number;
};

export function clusterPrompts(
  prompts: PromptLike[],
  newId: () => string = randomUUID,
): SessionCluster[] {
  const sorted = [...prompts].sort(
    (a, b) => a.startedAt - b.startedAt || a.id - b.id,
  );
  const clusters: SessionCluster[] = [];

  for (const prompt of sorted) {
    const current = clusters[clusters.length - 1];
    if (!current || prompt.startedAt - current.endedAt >= SESSION_INACTIVITY_MS) {
      clusters.push({
        sessionId: newId(),
        promptIds: [prompt.id],
        startedAt: prompt.startedAt,
        endedAt: prompt.endedAt,
      });
    } else {
      current.promptIds.push(prompt.id);
      current.endedAt = Math.max(current.endedAt, prompt.endedAt);
    }
  }

  return clusters;
}

export function clusterStateChanges(
  events: PromptLike[],
  newId: () => string = randomUUID,
): SessionCluster[] {
  const sorted = [...events].sort(
    (a, b) => a.startedAt - b.startedAt || a.id - b.id,
  );
  const clusters: Array<SessionCluster & { lastStartedAt: number }> = [];

  for (const event of sorted) {
    const current = clusters[clusters.length - 1];
    if (!current || event.startedAt - current.lastStartedAt >= SESSION_INACTIVITY_MS) {
      clusters.push({
        sessionId: newId(),
        promptIds: [event.id],
        startedAt: event.startedAt,
        lastStartedAt: event.startedAt,
        endedAt: event.endedAt,
      });
    } else {
      current.promptIds.push(event.id);
      current.lastStartedAt = event.startedAt;
      current.endedAt = Math.max(current.endedAt, event.endedAt);
    }
  }

  return clusters;
}

type LogRow = {
  id: number;
  state: AndonState;
  started_at: Date | string;
  ended_at: Date | string;
};

function toTime(value: Date | string): number {
  const date = value instanceof Date ? value : new Date(value);
  return date.getTime();
}

function toIso(value: number): string {
  return new Date(value).toISOString();
}

export async function refreshMemberSessionIds(memberId: string) {
  const { rows } = await sql<LogRow>`
    SELECT id, state, started_at, ended_at
    FROM state_log
    WHERE member_id = ${memberId}
    ORDER BY started_at ASC, id ASC
  `;

  const events: StateChangeLike[] = rows.map((row) => ({
    id: row.id,
    startedAt: toTime(row.started_at),
    endedAt: toTime(row.ended_at),
  }));
  const clusters = clusterStateChanges(events);

  for (const cluster of clusters) {
    const sessionStart = toIso(cluster.startedAt);
    for (const id of cluster.promptIds) {
      await sql`
        UPDATE state_log
        SET
          session_id = ${cluster.sessionId}::uuid,
          session_start_time = ${sessionStart}::timestamptz
        WHERE id = ${id}
      `;
    }
  }
}

export async function backfillSessionIds(options?: { replace?: boolean }) {
  if (options?.replace) {
    await sql`
      UPDATE state_log
      SET session_id = NULL, session_start_time = NULL
    `;
  }

  await sql`
    WITH ordered AS (
      SELECT
        id,
        member_id,
        started_at,
        LAG(started_at) OVER (
          PARTITION BY member_id
          ORDER BY started_at ASC, id ASC
        ) AS prev_started_at
      FROM state_log
      WHERE session_id IS NULL
    ),
    flagged AS (
      SELECT
        id,
        member_id,
        started_at,
        CASE
          WHEN prev_started_at IS NULL THEN 1
          WHEN started_at >= prev_started_at + INTERVAL '15 minutes' THEN 1
          ELSE 0
        END AS is_new
      FROM ordered
    ),
    numbered AS (
      SELECT
        id,
        member_id,
        started_at,
        SUM(is_new) OVER (
          PARTITION BY member_id
          ORDER BY started_at ASC, id ASC
        ) AS grp
      FROM flagged
    ),
    ids AS (
      SELECT
        member_id,
        grp,
        gen_random_uuid() AS session_id,
        MIN(started_at) AS session_start_time
      FROM numbered
      GROUP BY member_id, grp
    )
    UPDATE state_log sl
    SET
      session_id = ids.session_id,
      session_start_time = ids.session_start_time
    FROM numbered
    JOIN ids
      ON ids.member_id = numbered.member_id
     AND ids.grp = numbered.grp
    WHERE sl.id = numbered.id
  `;

  await sql`
    UPDATE state_log sl
    SET session_start_time = bounds.session_start_time
    FROM (
      SELECT session_id, MIN(started_at) AS session_start_time
      FROM state_log
      WHERE session_id IS NOT NULL
      GROUP BY session_id
    ) bounds
    WHERE sl.session_id = bounds.session_id
      AND sl.session_start_time IS NULL
  `;
}

export async function ensureSessionGroupingSchema() {
  await sql`ALTER TABLE state_log ADD COLUMN IF NOT EXISTS session_id UUID`;
  await sql`ALTER TABLE state_log ADD COLUMN IF NOT EXISTS session_start_time TIMESTAMPTZ`;
  await sql`CREATE INDEX IF NOT EXISTS state_log_session_id_idx ON state_log (session_id)`;
  await sql`CREATE INDEX IF NOT EXISTS state_log_session_start_time_idx ON state_log (session_start_time)`;
  await sql`CREATE INDEX IF NOT EXISTS state_log_member_session_idx ON state_log (member_id, session_id)`;
}

export async function createStatsViews() {
  await sql`DROP VIEW IF EXISTS monthly_stats`;
  await sql`DROP VIEW IF EXISTS daily_stats`;
  await sql`DROP VIEW IF EXISTS working_sessions`;

  await sql`
    CREATE VIEW working_sessions AS
    SELECT
      sl.member_id,
      sl.session_id,
      MIN(sl.session_start_time) AS session_start_time,
      MIN(sl.started_at) AS work_start,
      MAX(sl.ended_at) AS work_end,
      COUNT(*)::int AS prompt_count,
      GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (MAX(sl.ended_at) - MIN(sl.started_at))))
      )::int AS duration_seconds
    FROM state_log sl
    WHERE sl.state = 'yellow'
      AND sl.session_id IS NOT NULL
    GROUP BY sl.member_id, sl.session_id
  `;

  await sql`
    CREATE VIEW daily_stats AS
    WITH colors AS (
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
    ),
    color_days AS (
      SELECT
        member_id,
        day,
        SUM(yellow_seconds)::bigint AS total_yellow,
        SUM(red_seconds)::bigint AS total_red,
        SUM(green_seconds)::bigint AS total_green
      FROM colors
      GROUP BY member_id, day
    ),
    session_days AS (
      SELECT
        ws.member_id,
        gs::date AS day,
        ws.session_id,
        GREATEST(
          0,
          FLOOR(EXTRACT(EPOCH FROM (
            LEAST(ws.work_end, ((gs::date + 1) AT TIME ZONE 'UTC'))
            - GREATEST(ws.work_start, (gs::date AT TIME ZONE 'UTC'))
          )))
        )::int AS session_seconds
      FROM working_sessions ws
      CROSS JOIN LATERAL generate_series(
        (ws.work_start AT TIME ZONE 'UTC')::date,
        (ws.work_end AT TIME ZONE 'UTC')::date,
        INTERVAL '1 day'
      ) AS gs
    ),
    session_totals AS (
      SELECT
        member_id,
        day,
        COUNT(*)::int AS session_count,
        SUM(session_seconds)::bigint AS total_session_seconds,
        CASE
          WHEN COUNT(*) > 0 THEN ROUND(SUM(session_seconds)::numeric / COUNT(*))
          ELSE 0
        END::bigint AS avg_session_seconds
      FROM session_days
      WHERE session_seconds > 0
      GROUP BY member_id, day
    )
    SELECT
      m.id AS member_id,
      m.team_id,
      m.name AS member_name,
      d.day,
      COALESCE(d.total_yellow, 0)::bigint AS total_yellow,
      COALESCE(d.total_red, 0)::bigint AS total_red,
      COALESCE(d.total_green, 0)::bigint AS total_green,
      COALESCE(s.session_count, 0)::int AS session_count,
      COALESCE(s.total_session_seconds, 0)::bigint AS total_session_seconds,
      COALESCE(s.avg_session_seconds, 0)::bigint AS avg_session_seconds
    FROM members m
    JOIN color_days d ON d.member_id = m.id
    LEFT JOIN session_totals s
      ON s.member_id = m.id
     AND s.day = d.day
  `;

  await sql`
    CREATE VIEW monthly_stats AS
    WITH month_colors AS (
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
    ),
    session_months AS (
      SELECT
        ws.member_id,
        EXTRACT(YEAR FROM month_start)::int AS year,
        EXTRACT(MONTH FROM month_start)::int AS month,
        ws.session_id,
        GREATEST(
          0,
          FLOOR(EXTRACT(EPOCH FROM (
            LEAST(ws.work_end, month_start + INTERVAL '1 month')
            - GREATEST(ws.work_start, month_start)
          )))
        )::int AS session_seconds
      FROM working_sessions ws
      CROSS JOIN LATERAL generate_series(
        date_trunc('month', ws.work_start AT TIME ZONE 'UTC'),
        date_trunc('month', ws.work_end AT TIME ZONE 'UTC'),
        INTERVAL '1 month'
      ) AS month_start
    ),
    session_totals AS (
      SELECT
        member_id,
        year,
        month,
        COUNT(*)::int AS session_count,
        SUM(session_seconds)::bigint AS total_session_seconds,
        CASE
          WHEN COUNT(*) > 0 THEN ROUND(SUM(session_seconds)::numeric / COUNT(*))
          ELSE 0
        END::bigint AS avg_session_seconds
      FROM session_months
      WHERE session_seconds > 0
      GROUP BY member_id, year, month
    )
    SELECT
      c.member_id,
      c.team_id,
      c.member_name,
      c.year,
      c.month,
      c.total_yellow,
      c.total_red,
      c.total_green,
      COALESCE(s.session_count, 0)::int AS session_count,
      COALESCE(s.total_session_seconds, 0)::bigint AS total_session_seconds,
      COALESCE(s.avg_session_seconds, 0)::bigint AS avg_session_seconds
    FROM month_colors c
    LEFT JOIN session_totals s
      ON s.member_id = c.member_id
     AND s.year = c.year
     AND s.month = c.month
  `;
}

export async function applySessionGroupingMigration() {
  await ensureSessionGroupingSchema();
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const { rows } = await sql<{ id: string }>`
    SELECT id FROM schema_migrations WHERE id = ${SESSION_GROUPING_MIGRATION}
  `;

  if (!rows[0]) {
    await backfillSessionIds({ replace: true });
    await sql`
      INSERT INTO schema_migrations (id)
      VALUES (${SESSION_GROUPING_MIGRATION})
    `;
  } else {
    await backfillSessionIds();
  }

  await createStatsViews();
}
