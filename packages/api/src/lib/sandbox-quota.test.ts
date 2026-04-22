/**
 * Tests for the pure helpers inside sandbox-quota. The full
 * checkAndIncrement path runs an atomic UPSERT against Postgres; that's
 * exercised empirically in dev (the plan's Unit 10 concurrency test is a
 * blocking criterion there — 100 parallel callers against a 10-cap room
 * should land exactly 10 ok's).
 */

import { describe, it, expect } from "vitest";
import {
  nextHourUtc,
  sqlStateOf,
  tomorrowUtcMidnight,
} from "./sandbox-quota.js";

describe("tomorrowUtcMidnight", () => {
  it("returns 00:00 UTC the day after now()", () => {
    const now = new Date("2026-04-22T15:30:00Z");
    expect(tomorrowUtcMidnight(now)).toBe("2026-04-23T00:00:00.000Z");
  });

  it("rolls across month boundary", () => {
    const now = new Date("2026-04-30T23:59:59Z");
    expect(tomorrowUtcMidnight(now)).toBe("2026-05-01T00:00:00.000Z");
  });

  it("rolls across year boundary", () => {
    const now = new Date("2026-12-31T20:00:00Z");
    expect(tomorrowUtcMidnight(now)).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("nextHourUtc", () => {
  it("returns the top of the next hour", () => {
    const now = new Date("2026-04-22T14:23:17Z");
    expect(nextHourUtc(now)).toBe("2026-04-22T15:00:00.000Z");
  });

  it("rolls across day boundary", () => {
    const now = new Date("2026-04-22T23:42:00Z");
    expect(nextHourUtc(now)).toBe("2026-04-23T00:00:00.000Z");
  });
});

describe("sqlStateOf", () => {
  it("reads pg-style .code", () => {
    expect(sqlStateOf({ code: "40P01" })).toBe("40P01");
  });

  it("reads mysql-style .sqlState", () => {
    expect(sqlStateOf({ sqlState: "40001" })).toBe("40001");
  });

  it("returns undefined for non-object input", () => {
    expect(sqlStateOf(null)).toBeUndefined();
    expect(sqlStateOf("string")).toBeUndefined();
    expect(sqlStateOf(42)).toBeUndefined();
  });
});
