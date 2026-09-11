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

export function isAndonState(value: unknown): value is AndonState {
  return (
    typeof value === "string" &&
    (ANDON_STATES as readonly string[]).includes(value)
  );
}
