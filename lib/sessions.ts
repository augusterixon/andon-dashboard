import { randomUUID } from "crypto";
import { sql } from "@vercel/postgres";
import type { AndonState } from "@/lib/types";

export const SESSION_INACTIVITY_MS = 15 * 60 * 1000;

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

export async function refreshMemberSessionIds(memberId: string) {
  const { rows } = await sql<LogRow>`
    SELECT id, state, started_at, ended_at
    FROM state_log
    WHERE member_id = ${memberId}
    ORDER BY started_at ASC, id ASC
  `;

  const prompts = rows
    .filter((row) => row.state === "yellow")
    .map((row) => ({
      id: row.id,
      startedAt: toTime(row.started_at),
      endedAt: toTime(row.ended_at),
    }));

  const clusters = clusterPrompts(prompts);
  const byLogId = new Map<number, string>();

  for (const cluster of clusters) {
    for (const id of cluster.promptIds) {
      byLogId.set(id, cluster.sessionId);
    }
    for (const row of rows) {
      if (row.state === "yellow") continue;
      const started = toTime(row.started_at);
      if (started >= cluster.startedAt && started <= cluster.endedAt) {
        byLogId.set(row.id, cluster.sessionId);
      }
    }
  }

  const grouped = new Map<string, number[]>();
  for (const [id, sessionId] of byLogId) {
    const list = grouped.get(sessionId) ?? [];
    list.push(id);
    grouped.set(sessionId, list);
  }

  for (const [sessionId, ids] of grouped) {
    for (const id of ids) {
      await sql`
        UPDATE state_log
        SET session_id = ${sessionId}::uuid
        WHERE id = ${id}
      `;
    }
  }
}

export async function backfillSessionIds() {
  await sql`
    WITH ordered AS (
      SELECT
        id,
        member_id,
        started_at,
        ended_at,
        LAG(ended_at) OVER (
          PARTITION BY member_id
          ORDER BY started_at ASC, id ASC
        ) AS prev_ended_at
      FROM state_log
      WHERE state = 'yellow'
    ),
    flagged AS (
      SELECT
        id,
        member_id,
        started_at,
        CASE
          WHEN prev_ended_at IS NULL THEN 1
          WHEN started_at >= prev_ended_at + INTERVAL '15 minutes' THEN 1
          ELSE 0
        END AS is_new
      FROM ordered
    ),
    numbered AS (
      SELECT
        id,
        member_id,
        SUM(is_new) OVER (
          PARTITION BY member_id
          ORDER BY started_at ASC, id ASC
        ) AS grp
      FROM flagged
    ),
    ids AS (
      SELECT member_id, grp, gen_random_uuid() AS session_id
      FROM numbered
      GROUP BY member_id, grp
    )
    UPDATE state_log sl
    SET session_id = ids.session_id
    FROM numbered
    JOIN ids
      ON ids.member_id = numbered.member_id
     AND ids.grp = numbered.grp
    WHERE sl.id = numbered.id
      AND sl.session_id IS NULL
  `;

  await sql`
    WITH windows AS (
      SELECT
        member_id,
        session_id,
        MIN(started_at) AS session_start,
        MAX(ended_at) AS session_end
      FROM state_log
      WHERE state = 'yellow'
        AND session_id IS NOT NULL
      GROUP BY member_id, session_id
    )
    UPDATE state_log sl
    SET session_id = w.session_id
    FROM windows w
    WHERE sl.member_id = w.member_id
      AND sl.session_id IS NULL
      AND sl.started_at >= w.session_start
      AND sl.started_at <= w.session_end
  `;
}
