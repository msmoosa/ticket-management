import { cn } from "@/lib/utils";
import { formatDuration, formatWaitingShort, waitingLevel, type WaitingLevel } from "@/lib/waiting";

const sinceFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const levelText: Record<WaitingLevel, string> = {
  calm: "text-waiting-calm",
  amber: "text-waiting-amber",
  brick: "text-waiting-brick",
};

// A hollow dot while the wait is short; filled once it needs attention.
const levelDot: Record<WaitingLevel, string> = {
  calm: "border border-current",
  amber: "bg-current",
  brick: "bg-current",
};

type Props = {
  /** ISO time the sender started waiting. */
  since: string;
  /** `short` for the queue ("26h"); `long` for the ticket page ("26 hours"). */
  format?: "short" | "long";
  className?: string;
};

// How long the ticket's sender has been waiting for an answer, coloured by urgency.
export default function WaitingTime({ since, format = "short", className }: Props) {
  const start = new Date(since);
  const ms = Math.max(0, Date.now() - start.getTime());
  const level = waitingLevel(ms);
  const label = format === "short" ? formatWaitingShort(ms) : formatDuration(ms);

  return (
    <span
      title={`Waiting since ${sinceFormat.format(start)}`}
      className={cn(
        "inline-flex items-center gap-1.5 font-medium tabular-nums",
        levelText[level],
        className,
      )}
    >
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", levelDot[level])} />
      {label}
    </span>
  );
}
