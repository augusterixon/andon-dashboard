export function formatDuration(fromIso: string, now = Date.now()): string {
  const started = new Date(fromIso).getTime();
  if (Number.isNaN(started)) return "—";

  const totalSeconds = Math.max(0, Math.floor((now - started) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
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
