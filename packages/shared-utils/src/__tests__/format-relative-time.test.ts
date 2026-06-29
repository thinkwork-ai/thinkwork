import { describe, it, expect, vi, afterEach } from "vitest";
import { formatRelativeTime } from "../format-relative-time.js";

describe("formatRelativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty string for null/undefined", () => {
    expect(formatRelativeTime(null)).toBe("");
    expect(formatRelativeTime(undefined)).toBe("");
  });

  it("returns 'just now' for times less than a minute ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:00:30Z"));
    expect(formatRelativeTime("2025-01-15T12:00:00Z")).toBe("just now");
  });

  it("returns minutes ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:05:00Z"));
    expect(formatRelativeTime("2025-01-15T12:00:00Z")).toBe("5m ago");
  });

  it("returns hours ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T15:00:00Z"));
    expect(formatRelativeTime("2025-01-15T12:00:00Z")).toBe("3h ago");
  });

  it("returns days ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-20T12:00:00Z"));
    expect(formatRelativeTime("2025-01-15T12:00:00Z")).toBe("5d ago");
  });

  it("handles numeric timestamps (epoch ms)", () => {
    vi.useFakeTimers();
    const now = new Date("2025-01-15T12:05:00Z").getTime();
    vi.setSystemTime(now);
    expect(formatRelativeTime(now - 120_000)).toBe("2m ago");
  });

  it("handles future dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
    expect(formatRelativeTime("2025-01-15T12:05:00Z")).toBe("in 5m");
  });
});
