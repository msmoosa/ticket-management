import { useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import type { TicketStats } from "@/lib/tickets";

type Day = TicketStats["perDay"][number];

const tickFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** "2026-10-17" as a local date (not UTC midnight, which can be the day before). */
function parseDay(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function plural(n: number) {
  return `${n} ${n === 1 ? "ticket" : "tickets"}`;
}

/** Round axis: about four steps of 1, 2 or 5 × 10ⁿ (never fractional), from 0 to the top. */
export function axisTicks(max: number) {
  const raw = Math.max(max, 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!);
  const top = Math.max(step, Math.ceil(max / step) * step);
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

// Tickets received per day as columns, newest on the right. Hover, or focus the plot and use the
// arrow keys, for a day's count; the busiest day is labelled; a hidden table carries every value.
export default function TicketsPerDayChart({ perDay }: { perDay: Day[] }) {
  const [active, setActive] = useState<number | null>(null);
  const last = perDay.length - 1;

  const ticks = axisTicks(Math.max(0, ...perDay.map((d) => d.count)));
  const top = ticks.at(-1)!;
  const peak = perDay.reduce(
    (best, d, i) => (d.count > (perDay[best]?.count ?? 0) ? i : best),
    -1,
  );
  // A label every week, counted back from today.
  const labelled = (i: number) => (last - i) % 7 === 0;
  const describe = (i: number) =>
    `${i === last ? "Today" : dayFormat.format(parseDay(perDay[i]!.date))}: ${plural(perDay[i]!.count)}`;

  function handleKeyDown(event: KeyboardEvent) {
    const next = {
      ArrowLeft: (active ?? last + 1) - 1,
      ArrowRight: (active ?? -1) + 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(Math.min(last, Math.max(0, next)));
  }

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3">
      {/* Y axis */}
      <div aria-hidden className="relative h-52 w-6">
        {ticks.map((tick) => (
          <span
            key={tick}
            className="absolute right-0 translate-y-1/2 text-xs text-muted-foreground tabular-nums"
            style={{ bottom: `${(tick / top) * 100}%` }}
          >
            {tick}
          </span>
        ))}
      </div>

      {/* Plot */}
      <div
        tabIndex={0}
        role="group"
        aria-label="Tickets received per day. Use the arrow keys to read each day."
        onKeyDown={handleKeyDown}
        onFocus={() => setActive((current) => current ?? last)}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        className="relative h-52 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-4 focus-visible:ring-offset-card"
      >
        {ticks.map((tick) => (
          <div
            key={tick}
            aria-hidden
            className={cn(
              "absolute inset-x-0 border-t",
              tick === 0 ? "border-foreground/25" : "border-border/70",
            )}
            style={{ bottom: `${(tick / top) * 100}%` }}
          />
        ))}

        <div className="absolute inset-0 flex items-end gap-0.5">
          {perDay.map((day, i) => {
            const height = (day.count / top) * 100;
            const isActive = active === i;
            return (
              // The whole column is the hit target, not just the painted bar.
              <div
                key={day.date}
                aria-hidden
                onPointerEnter={() => setActive(i)}
                className="relative flex h-full min-w-0 flex-1 items-end justify-center"
              >
                {isActive && (
                  <div
                    aria-hidden
                    className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground/10"
                  />
                )}
                <div
                  className={cn(
                    "relative w-full max-w-6 rounded-t-[4px] transition-colors",
                    isActive ? "bg-accent-foreground" : "bg-primary",
                  )}
                  // Days with tickets stay visible even when tiny next to the busiest day.
                  style={{ height: day.count ? `max(${height}%, 3px)` : 0 }}
                />
                {i === peak && !isActive && (
                  <span
                    className="pointer-events-none absolute left-1/2 -translate-x-1/2 pb-1 text-xs font-medium text-muted-foreground tabular-nums"
                    style={{ bottom: `${height}%` }}
                  >
                    {day.count}
                  </span>
                )}
                {isActive && (
                  <div
                    className={cn(
                      "pointer-events-none absolute z-10 mb-2 rounded-md border bg-popover px-2.5 py-1.5 whitespace-nowrap text-popover-foreground shadow-md",
                      // Keep the tooltip inside the plot at either end.
                      i < 3 ? "left-0" : i > last - 3 ? "right-0" : "left-1/2 -translate-x-1/2",
                    )}
                    style={{ bottom: `${height}%` }}
                  >
                    <p className="text-sm font-semibold tabular-nums">{plural(day.count)}</p>
                    <p className="text-xs text-muted-foreground">
                      {i === last ? "Today, so far" : dayFormat.format(parseDay(day.date))}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* X axis */}
      <div />
      <div aria-hidden className="relative mt-2 flex h-4 gap-0.5">
        {perDay.map((day, i) => (
          <div key={day.date} className="relative min-w-0 flex-1">
            {labelled(i) && (
              <span
                className={cn(
                  "absolute top-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums",
                  i === last ? "right-0" : "left-1/2 -translate-x-1/2",
                )}
              >
                {i === last ? "Today" : tickFormat.format(parseDay(day.date))}
              </span>
            )}
          </div>
        ))}
      </div>

      <p aria-live="polite" className="sr-only">
        {active !== null && describe(active)}
      </p>
      <table className="sr-only">
        <caption>Tickets received per day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Tickets</th>
          </tr>
        </thead>
        <tbody>
          {perDay.map((day, i) => (
            <tr key={day.date}>
              <th scope="row">{i === last ? "Today" : dayFormat.format(parseDay(day.date))}</th>
              <td>{day.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
