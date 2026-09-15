export function formatSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  if (hours > 0) return rest > 0 || minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  return `${rest}s`;
}

export function formatElapsed(fromIso: string, now = Date.now()): string {
  const started = new Date(fromIso).getTime();
  if (Number.isNaN(started)) return "—";

  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

export function formatDuration(fromIso: string, now = Date.now()): string {
  return formatElapsed(fromIso, now);
}

export function formatJoined(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatLastActive(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";

  const delta = Math.max(0, now - then);
  if (delta < 15_000) return "Now";
  if (delta < 60_000) return "Just now";
  if (delta < 60 * 60 * 1000) return `${Math.floor(delta / 60_000)}m ago`;

  const date = new Date(then);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  if (then >= startOfToday.getTime()) return time;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatSessionLine(
  index: number,
  durationSeconds: number,
  startedAt: string,
  endedAt: string | null,
  promptCount: number,
): string {
  const span = endedAt
    ? `${formatClock(startedAt)} - ${formatClock(endedAt)}`
    : `${formatClock(startedAt)} - now`;
  const prompts = promptCount === 1 ? "1 prompt" : `${promptCount} prompts`;
  return `Session ${index}: ${formatSeconds(durationSeconds)} (${span}) • ${prompts}`;
}

export function formatWorkingSummary(seconds: number, sessions: number): string {
  const sessionLabel = sessions === 1 ? "1 session" : `${sessions} sessions`;
  const avg =
    sessions > 0
      ? `avg ${formatSeconds(Math.round(seconds / sessions))}`
      : "avg 0s";
  return `${formatSeconds(seconds)}  •  ${sessionLabel}  •  ${avg}`;
}

export const STATE_META = {
  green: { label: "Ready", emoji: "🟢" },
  yellow: { label: "Working", emoji: "🟡" },
  red: { label: "Stopped", emoji: "🔴" },
} as const;
