const DEFAULT_DASHBOARD_URL = "https://andon-dashboard.vercel.app";

export function getDashboardUrl() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return DEFAULT_DASHBOARD_URL;
}

export function buildAndonJoinHref(input: {
  inviteCode: string;
  teamId: string;
  teamName: string;
  dashboardUrl?: string;
}) {
  return `andon://join?${new URLSearchParams({
    invite_code: input.inviteCode,
    team_id: input.teamId,
    team_name: input.teamName,
    dashboard_url: input.dashboardUrl ?? getDashboardUrl(),
  }).toString()}`;
}
