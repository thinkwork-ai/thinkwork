import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatTurnHeader,
  isRecoveringTurn,
  isRunningStatus,
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
    expect(formatTurnHeader("cancelled", false, 3000)).toBe(
      "Cancelled after 3s",
    );
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

// THINK-301 U6 (parent R9/AE3): recovery-in-flight renders the working
// affordance; exhausted recovery keeps the plain terminal label.
describe("isRecoveringTurn", () => {
  it("is true only for timed_out with recoveryPending === true", () => {
    expect(isRecoveringTurn("timed_out", true)).toBe(true);
    expect(isRecoveringTurn("TIMED_OUT", true)).toBe(true);
    expect(isRecoveringTurn("timed_out", false)).toBe(false);
    expect(isRecoveringTurn("timed_out", null)).toBe(false);
    expect(isRecoveringTurn("timed_out", undefined)).toBe(false);
    expect(isRecoveringTurn("failed", true)).toBe(false);
    expect(isRecoveringTurn("running", true)).toBe(false);
    expect(isRecoveringTurn(null, true)).toBe(false);
  });

  it("recovering renders Working… via the running header path; exhausted keeps Timed out", () => {
    // A recovering turn is passed isRunning=true by the surface, so the
    // header is the live working label — no raw internals.
    expect(formatTurnHeader("timed_out", true, 4000)).toBe("Working…");
    // Exhausted recovery (not running) keeps the plain terminal label.
    expect(formatTurnHeader("timed_out", false, 4000)).toBe(
      "Timed out after 4s",
    );
  });
});
