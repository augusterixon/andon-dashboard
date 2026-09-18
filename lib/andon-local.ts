const LOCAL_JOIN_URL = "http://127.0.0.1:9876/join";
const LOCAL_STATUS_URL = "http://127.0.0.1:9876/status";
const NOTIFY_TIMEOUT_MS = 1500;
const STATUS_TIMEOUT_MS = 800;
const FLASH_KEY = "andon.localConfigured";
const TRACKED_TEAM_KEY = "andon.trackedTeamId";

export type LocalAndonJoinPayload = {
  team_id: string;
  member_id: string;
  auth_token: string;
  team_name: string;
};

export async function notifyLocalAndon(
  payload: LocalAndonJoinPayload,
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS);
    const response = await fetch(LOCAL_JOIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dashboard_url: window.location.origin,
        team_id: payload.team_id,
        member_id: payload.member_id,
        auth_token: payload.auth_token,
        team_name: payload.team_name,
      }),
      signal: controller.signal,
    });
    window.clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

export function writeAndonConfiguredFlash(teamId?: string) {
  window.sessionStorage.setItem(FLASH_KEY, "1");
  if (teamId) writeTrackedTeam(teamId);
}

export function consumeAndonConfiguredFlash(): boolean {
  if (typeof window === "undefined") return false;
  const value = window.sessionStorage.getItem(FLASH_KEY);
  if (!value) return false;
  window.sessionStorage.removeItem(FLASH_KEY);
  return true;
}

export function writeTrackedTeam(teamId: string) {
  window.localStorage.setItem(TRACKED_TEAM_KEY, teamId);
}

export function readTrackedTeam(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TRACKED_TEAM_KEY);
  } catch {
    return null;
  }
}

export type AndonTrackingState = "tracking" | "offline";

export type LocalAndonStatus = {
  running: boolean;
  teamId: string | null;
  reportsTeam: boolean;
};

export async function fetchLocalAndonStatus(): Promise<LocalAndonStatus> {
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
    const response = await fetch(LOCAL_STATUS_URL, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    window.clearTimeout(timeout);
    const data = (await response.json().catch(() => null)) as
      | { team_id?: unknown }
      | null;
    const reportsTeam = Boolean(data && "team_id" in data);
    const teamId =
      reportsTeam && typeof data?.team_id === "string" && data.team_id.trim()
        ? data.team_id.trim()
        : null;
    return { running: true, teamId, reportsTeam };
  } catch {
    return { running: false, teamId: null, reportsTeam: false };
  }
}
