const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How urgent a wait is: under 4 hours, 4–24 hours, or a day or more. */
export type WaitingLevel = "calm" | "amber" | "brick";

export function waitingLevel(ms: number): WaitingLevel {
  return ms >= DAY ? "brick" : ms >= 4 * HOUR ? "amber" : "calm";
}

/** Compact wait for the queue: "12m", "26h" (up to two days), then "3d". */
export function formatWaitingShort(ms: number) {
  if (ms < HOUR) return `${Math.max(1, Math.floor(ms / MINUTE))}m`;
  if (ms < 2 * DAY) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.floor(ms / DAY)}d`;
}

function plural(n: number, unit: string) {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** Spelled-out duration: "12 minutes", "26 hours", "3 days". */
export function formatDuration(ms: number) {
  if (ms < HOUR) return plural(Math.max(1, Math.floor(ms / MINUTE)), "minute");
  if (ms < 2 * DAY) return plural(Math.floor(ms / HOUR), "hour");
  return plural(Math.floor(ms / DAY), "day");
}
