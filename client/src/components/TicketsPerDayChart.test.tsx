import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import TicketsPerDayChart, { axisTicks } from "./TicketsPerDayChart.tsx";

const perDay = [
  { date: "2026-10-15", count: 4 },
  { date: "2026-10-16", count: 1 },
  { date: "2026-10-17", count: 2 },
];

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

describe("axisTicks", () => {
  test("rounds to about four whole-number steps", () => {
    expect(axisTicks(0)).toEqual([0, 1]);
    expect(axisTicks(3)).toEqual([0, 1, 2, 3]);
    expect(axisTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(axisTicks(37)).toEqual([0, 10, 20, 30, 40]);
    expect(axisTicks(120)).toEqual([0, 50, 100, 150]);
  });
});

describe("TicketsPerDayChart", () => {
  test("labels the busiest day", () => {
    render(<TicketsPerDayChart perDay={perDay} />);
    // The peak label, plus the axis tick of the same value (hidden from assistive tech).
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
  });

  test("reads each day with the arrow keys, starting from today", async () => {
    const user = userEvent.setup();
    render(<TicketsPerDayChart perDay={perDay} />);

    await user.tab();
    expect(screen.getByRole("group", { name: /Tickets received per day/ })).toHaveFocus();
    expect(screen.getByText("Today: 2 tickets")).toBeInTheDocument();
    expect(screen.getByText("Today, so far")).toBeInTheDocument();

    await user.keyboard("{ArrowLeft}");
    expect(
      screen.getByText(`${dayFormat.format(new Date(2026, 9, 16))}: 1 ticket`),
    ).toBeInTheDocument();

    await user.keyboard("{Home}");
    expect(
      screen.getByText(`${dayFormat.format(new Date(2026, 9, 15))}: 4 tickets`),
    ).toBeInTheDocument();
  });
});
