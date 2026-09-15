-- Session grouping migration for Neon / Vercel Postgres.
-- Groups each member's state_log rows chronologically: a new session_id starts
-- when 15+ minutes pass between consecutive state-change timestamps.
-- session_start_time is the timestamp of the first row in that session.

ALTER TABLE state_log ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE state_log ADD COLUMN IF NOT EXISTS session_start_time TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS state_log_session_id_idx ON state_log (session_id);
CREATE INDEX IF NOT EXISTS state_log_session_start_time_idx ON state_log (session_start_time);
CREATE INDEX IF NOT EXISTS state_log_member_session_idx ON state_log (member_id, session_id);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

UPDATE state_log
SET session_id = NULL, session_start_time = NULL;

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
WHERE sl.id = numbered.id;

DROP VIEW IF EXISTS monthly_stats;
DROP VIEW IF EXISTS daily_stats;
DROP VIEW IF EXISTS working_sessions;

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
GROUP BY sl.member_id, sl.session_id;

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
 AND s.day = d.day;

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
 AND s.month = c.month;

INSERT INTO schema_migrations (id)
VALUES ('002_session_grouping')
ON CONFLICT (id) DO NOTHING;
