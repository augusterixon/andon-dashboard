import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SESSION_GAP_MS = 15 * 60 * 1000;
const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";

function loadEnv() {
  const envPath = resolve(process.cwd(), ".env.local");
  let text = "";
  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    return;
  }

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function splitSqlStatements(text) {
  return text
    .split(/;\s*(?:\n|$)/)
    .map((statement) =>
      statement
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  loadEnv();
  if (!process.env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is not set");
  }

  const { sql } = await import("@vercel/postgres");

  async function runMigration() {
    const sqlPath = resolve(process.cwd(), "scripts/migrate-session-grouping.sql");
    const statements = splitSqlStatements(readFileSync(sqlPath, "utf8"));
    for (const statement of statements) {
      await sql.query(statement);
    }
  }

  async function verifyGrouping() {
    const { rows: missing } = await sql`
      SELECT COUNT(*)::int AS count
      FROM state_log
      WHERE session_id IS NULL OR session_start_time IS NULL
    `;
    assert(missing[0].count === 0, `${missing[0].count} state_log rows are missing session fields`);

    const { rows: startMismatch } = await sql`
      SELECT COUNT(*)::int AS count
      FROM state_log sl
      JOIN (
        SELECT session_id, MIN(started_at) AS first_started_at
        FROM state_log
        GROUP BY session_id
      ) bounds ON bounds.session_id = sl.session_id
      WHERE sl.session_start_time <> bounds.first_started_at
    `;
    assert(startMismatch[0].count === 0, "session_start_time must match the first row in the session");

    const { rows: members } = await sql`
      SELECT DISTINCT member_id FROM state_log
    `;

    for (const member of members) {
      const { rows } = await sql`
        SELECT id, started_at, session_id, session_start_time
        FROM state_log
        WHERE member_id = ${member.member_id}
        ORDER BY started_at ASC, id ASC
      `;

      for (let i = 1; i < rows.length; i += 1) {
        const prev = rows[i - 1];
        const curr = rows[i];
        const gap = new Date(curr.started_at).getTime() - new Date(prev.started_at).getTime();
        if (gap < SESSION_GAP_MS) {
          assert(
            curr.session_id === prev.session_id,
            `rows ${prev.id} and ${curr.id} are < 15m apart but have different session_ids`,
          );
        } else {
          assert(
            curr.session_id !== prev.session_id,
            `rows ${prev.id} and ${curr.id} are 15m+ apart but share a session_id`,
          );
        }
      }
    }

    console.log(`grouped ${members.length} members, all session gaps look correct`);
  }

  async function verifyAgainstApi() {
    const { rows: teams } = await sql`
      SELECT t.id, t.name, COUNT(sl.id)::int AS log_count
      FROM teams t
      JOIN members m ON m.team_id = t.id
      JOIN state_log sl ON sl.member_id = m.id
      GROUP BY t.id, t.name
      ORDER BY COUNT(sl.id) DESC
      LIMIT 1
    `;
    const team = teams[0];
    if (!team) {
      console.log("no state_log rows yet; skipped API comparison");
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const { rows: viewRows } = await sql`
      SELECT member_name, session_count, total_session_seconds, avg_session_seconds
      FROM daily_stats
      WHERE team_id = ${team.id}
        AND day = ${today}::date
      ORDER BY member_name
    `;

    let payload;
    try {
      const res = await fetch(`${BASE_URL}/api/stats/today?team_id=${team.id}`, {
        cache: "no-store",
      });
      payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || res.statusText);
      }
    } catch (error) {
      console.log(`API comparison skipped (${error.message})`);
      console.log("daily_stats", viewRows);
      return;
    }

    const byName = new Map((payload.members || []).map((member) => [member.name, member]));
    for (const row of viewRows) {
      const member = byName.get(row.member_name);
      if (!member) continue;
      const closedSessions = (member.sessions || []).filter((session) => session.ended_at);
      const viewCount = Number(row.session_count);
      if (closedSessions.length !== viewCount) {
        const liveCount = (member.sessions || []).length;
        console.log(
          `${row.member_name}: view session_count=${viewCount} closed_api=${closedSessions.length} live_api=${liveCount} (open current-state intervals are not in state_log)`,
        );
      } else {
        console.log(`${row.member_name}: session_count ${viewCount} matches closed API sessions`);
      }

      const closedSeconds = closedSessions.reduce((sum, session) => sum + session.duration_seconds, 0);
      if (closedSessions.length > 0 && Number(row.total_session_seconds) !== closedSeconds) {
        const liveSeconds = (member.sessions || []).reduce((sum, session) => sum + session.duration_seconds, 0);
        console.log(
          `${row.member_name}: view duration=${row.total_session_seconds}s closed_api=${closedSeconds}s live_api=${liveSeconds}s`,
        );
      }
    }

    console.log(`verified team ${team.name} against ${BASE_URL}`);
  }

  console.log("running session grouping migration...");
  await runMigration();
  console.log("migration applied");
  await verifyGrouping();
  await verifyAgainstApi();
  console.log("OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
