CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  invite_code VARCHAR(8) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  auth_token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS current_state (
  member_id UUID PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('green', 'yellow', 'red')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS state_log (
  id SERIAL PRIMARY KEY,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('green', 'yellow', 'red')),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_seconds INTEGER NOT NULL,
  session_id UUID
);

CREATE INDEX IF NOT EXISTS members_team_id_idx ON members (team_id);
CREATE INDEX IF NOT EXISTS state_log_member_id_idx ON state_log (member_id);
CREATE INDEX IF NOT EXISTS state_log_started_at_idx ON state_log (started_at);
CREATE INDEX IF NOT EXISTS state_log_ended_at_idx ON state_log (ended_at);
CREATE INDEX IF NOT EXISTS state_log_session_id_idx ON state_log (session_id);

CREATE OR REPLACE VIEW daily_stats AS
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
GROUP BY m.id, m.team_id, m.name, d.day;

CREATE OR REPLACE VIEW monthly_stats AS
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
GROUP BY member_id, team_id, member_name, EXTRACT(YEAR FROM day), EXTRACT(MONTH FROM day);
