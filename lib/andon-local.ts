const LOCAL_JOIN_URL = "http://127.0.0.1:9876/join";
const NOTIFY_TIMEOUT_MS = 1500;
const FLASH_KEY = "andon.localConfigured";

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

export function writeAndonConfiguredFlash() {
  window.sessionStorage.setItem(FLASH_KEY, "1");
}

export function consumeAndonConfiguredFlash(): boolean {
  if (typeof window === "undefined") return false;
  const value = window.sessionStorage.getItem(FLASH_KEY);
  if (!value) return false;
  window.sessionStorage.removeItem(FLASH_KEY);
  return true;
}
