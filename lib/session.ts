import type { Session } from "@/lib/types";

const STORAGE_KEY = "andon.session";

export function readSession(): Session | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (
      !parsed.team_id ||
      !parsed.member_id ||
      !parsed.auth_token ||
      !parsed.member_name
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSession(session: Session) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function sessionForTeam(teamId: string): Session | null {
  const session = readSession();
  if (!session || session.team_id !== teamId) return null;
  return session;
}
