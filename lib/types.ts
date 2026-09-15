export const ANDON_STATES = ["green", "yellow", "red"] as const;

export type AndonState = (typeof ANDON_STATES)[number];

export type Team = {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
};

export type MemberStatus = {
  id: string;
  name: string;
  state: AndonState;
  updated_at: string;
  created_at: string;
};

export type Session = {
  team_id: string;
  member_id: string;
  auth_token: string;
  member_name: string;
};

export type TeamStatus = {
  team: Pick<Team, "id" | "name" | "invite_code">;
  members: MemberStatus[];
};

export type WorkPrompt = {
  started_at: string;
  ended_at: string | null;
};

export type WorkSession = {
  session_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  prompt_count: number;
  prompts: WorkPrompt[];
};

export type MemberTimeStats = {
  member_id: string;
  name: string;
  state: AndonState;
  yellow_seconds: number;
  red_seconds: number;
  green_seconds: number;
  working_seconds: number;
  working_sessions: number;
  avg_session_seconds: number;
  last_working_at: string | null;
  sessions: WorkSession[];
};

export type LeaderboardPeriod = "today" | "month";

export type LeaderboardEntry = {
  rank: number;
  member_id: string;
  name: string;
  state: AndonState;
  working_seconds: number;
  working_sessions: number;
  avg_session_seconds: number;
  sessions: WorkSession[];
};

export type Leaderboard = {
  period: LeaderboardPeriod;
  entries: LeaderboardEntry[];
};

export function isAndonState(value: unknown): value is AndonState {
  return (
    typeof value === "string" &&
    (ANDON_STATES as readonly string[]).includes(value)
  );
}
