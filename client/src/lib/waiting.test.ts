import { describe, expect, test } from "vitest";
import { formatDuration, formatWaitingShort, waitingLevel } from "./waiting.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("waiting", () => {
  test("levels change at 4 hours and at a day", () => {
    expect(waitingLevel(4 * HOUR - 1)).toBe("calm");
    expect(waitingLevel(4 * HOUR)).toBe("amber");
    expect(waitingLevel(DAY - 1)).toBe("amber");
    expect(waitingLevel(DAY)).toBe("brick");
  });

  test("short format uses minutes, then hours up to two days, then days", () => {
    expect(formatWaitingShort(0)).toBe("1m");
    expect(formatWaitingShort(59 * MINUTE)).toBe("59m");
    expect(formatWaitingShort(HOUR)).toBe("1h");
    expect(formatWaitingShort(47 * HOUR)).toBe("47h");
    expect(formatWaitingShort(2 * DAY)).toBe("2d");
  });

  test("long format spells units out", () => {
    expect(formatDuration(MINUTE)).toBe("1 minute");
    expect(formatDuration(3 * HOUR)).toBe("3 hours");
    expect(formatDuration(1 * HOUR)).toBe("1 hour");
    expect(formatDuration(9 * DAY)).toBe("9 days");
  });
});
