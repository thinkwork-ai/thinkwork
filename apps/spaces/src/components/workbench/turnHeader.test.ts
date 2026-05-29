import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatTurnHeader,
  isRunningStatus,
  shouldDefaultExpand,
} from "./turnHeader";

describe("formatDuration", () => {
  it("floors sub-second durations to 1s", () => {
    expect(formatDuration(850)).toBe("1s");
    expect(formatDuration(400)).toBe("1s");
  });

  it("omits the minutes segment under a minute", () => {
    expect(formatDuration(12000)).toBe("12s");
  });

  it("includes a zero-second segment at exactly one minute", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
  });

  it("formats multi-minute durations", () => {
    expect(formatDuration(207000)).toBe("3m 27s");
    expect(formatDuration(90000)).toBe("1m 30s");
  });

  it("returns empty string for invalid input", () => {
    expect(formatDuration(Number.NaN)).toBe("");
    expect(formatDuration(-5)).toBe("");
  });
});

describe("formatTurnHeader", () => {
  it("shows Working… for a started running turn", () => {
    expect(formatTurnHeader("running", true, 12000)).toBe("Working…");
  });

  it("shows Queued… for a running turn that has not started", () => {
    expect(formatTurnHeader("queued", true, null)).toBe("Queued…");
  });

  it("shows Worked for a succeeded turn", () => {
    expect(formatTurnHeader("succeeded", false, 12000)).toBe("Worked for 12s");
    expect(formatTurnHeader("completed", false, 207000)).toBe(
      "Worked for 3m 27s",
    );
  });

  it("shows distinct headers for non-success terminal states", () => {
    expect(formatTurnHeader("failed", false, 5000)).toBe("Failed after 5s");
    expect(formatTurnHeader("cancelled", false, 3000)).toBe("Cancelled after 3s");
    expect(formatTurnHeader("timed_out", false, 90000)).toBe(
      "Timed out after 1m 30s",
    );
  });

  it("returns null for skipped turns", () => {
    expect(formatTurnHeader("skipped", false, null)).toBeNull();
  });

  it("falls back to a bare label when duration is unknown", () => {
    expect(formatTurnHeader("succeeded", false, null)).toBe("Worked");
    expect(formatTurnHeader("failed", false, null)).toBe("Failed");
  });
});

describe("isRunningStatus", () => {
  it("treats running/pending/queued/claimed as running", () => {
    for (const s of ["running", "pending", "queued", "claimed", "RUNNING"]) {
      expect(isRunningStatus(s)).toBe(true);
    }
  });

  it("treats terminal statuses as not running", () => {
    for (const s of [
      "succeeded",
      "completed",
      "failed",
      "cancelled",
      "timed_out",
      "skipped",
      null,
      undefined,
    ]) {
      expect(isRunningStatus(s)).toBe(false);
    }
  });
});

describe("shouldDefaultExpand", () => {
  it("expands failed turns by default", () => {
    expect(shouldDefaultExpand("failed")).toBe(true);
  });

  it("keeps other terminal turns collapsed", () => {
    expect(shouldDefaultExpand("succeeded")).toBe(false);
    expect(shouldDefaultExpand("cancelled")).toBe(false);
    expect(shouldDefaultExpand(null)).toBe(false);
  });
});
