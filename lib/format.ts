export function formatSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
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

export const STATE_META = {
  green: { label: "Good", emoji: "🟢" },
  yellow: { label: "Waiting", emoji: "🟡" },
  red: { label: "Stopped", emoji: "🔴" },
} as const;
