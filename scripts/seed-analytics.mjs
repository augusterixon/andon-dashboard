import { sql } from "@vercel/postgres";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`${path} ${res.status}: ${data.error || JSON.stringify(data)}`);
  }
  return data;
}

async function get(path) {
  const res = await fetch(`${BASE_URL}${path}`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`${path} ${res.status}: ${data.error || JSON.stringify(data)}`);
  }
  return data;
}

function iso(date) {
  return date.toISOString();
}

function atFraction(start, end, fraction) {
  return new Date(start.getTime() + (end.getTime() - start.getTime()) * fraction);
}

async function replay(teamId, member, start, steps) {
  await sql`
    UPDATE current_state
    SET state = 'green', updated_at = ${iso(start)}
    WHERE member_id = ${member.member_id}
  `;

  for (const step of steps) {
    await post("/api/state", {
      team_id: teamId,
      member_id: member.member_id,
      auth_token: member.auth_token,
      state: step.state,
      timestamp: iso(step.at),
    });
  }
}

async function main() {
  const now = new Date();
  const utcMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const start = new Date(
    Math.max(utcMidnight.getTime() + 30 * 60 * 1000, now.getTime() - 7 * 60 * 60 * 1000),
  );

  const team = await post("/api/team/create", { name: "Analytics Lab" });
  const avery = await post("/api/team/join", {
    invite_code: team.invite_code,
    name: "Avery",
  });
  const blake = await post("/api/team/join", {
    invite_code: team.invite_code,
    name: "Blake",
  });
  const casey = await post("/api/team/join", {
    invite_code: team.invite_code,
    name: "Casey",
  });

  const t = (fraction) => atFraction(start, now, fraction);

  await replay(team.team_id, avery, start, [
    { state: "yellow", at: t(0.18) },
    { state: "red", at: t(0.62) },
    { state: "green", at: t(0.68) },
    { state: "yellow", at: t(0.88) },
  ]);

  await replay(team.team_id, blake, start, [
    { state: "red", at: t(0.08) },
    { state: "yellow", at: t(0.42) },
    { state: "red", at: t(0.58) },
    { state: "green", at: t(0.92) },
  ]);

  await replay(team.team_id, casey, start, [
    { state: "yellow", at: t(0.12) },
    { state: "green", at: t(0.16) },
    { state: "red", at: t(0.2) },
    { state: "green", at: t(0.22) },
  ]);

  const { rows: logs } = await sql`
    SELECT name, state, duration_seconds, started_at, ended_at
    FROM state_log sl
    JOIN members m ON m.id = sl.member_id
    WHERE m.team_id = ${team.team_id}
    ORDER BY sl.started_at ASC
  `;
  if (logs.length === 0) {
    throw new Error("state_log is empty — transitions were not recorded");
  }
  if (logs.some((row) => Number(row.duration_seconds) <= 0)) {
    throw new Error("expected positive durations on seeded transitions");
  }

  const today = await get(`/api/stats/today?team_id=${team.team_id}`);
  const month = await get(
    `/api/stats/month?team_id=${team.team_id}&year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`,
  );
  const board = await get(`/api/leaderboard?team_id=${team.team_id}&period=today`);

  console.log("TEAM_ID", team.team_id);
  console.log("STATE_LOG", logs);
  console.log("TODAY", JSON.stringify(today, null, 2));
  console.log("MONTH", JSON.stringify(month, null, 2));
  console.log("LEADERBOARD", JSON.stringify(board, null, 2));

  const waiting = board.waiting.map((row) => row.name);
  const working = board.working.map((row) => row.name);
  if (waiting[0] !== "Avery") {
    throw new Error(`Expected Avery to lead waiting, got ${waiting.join(", ")}`);
  }
  if (working[0] !== "Blake") {
    throw new Error(`Expected Blake to lead working, got ${working.join(", ")}`);
  }

  const averyToday = today.members.find((row) => row.name === "Avery");
  if (!averyToday || averyToday.yellow_seconds < averyToday.green_seconds) {
    throw new Error("Avery should have more yellow than green today");
  }

  console.log("OK waiting=", waiting.join(" > "), "working=", working.join(" > "));
  console.log(`DASHBOARD ${BASE_URL}/dashboard?team_id=${team.team_id}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
