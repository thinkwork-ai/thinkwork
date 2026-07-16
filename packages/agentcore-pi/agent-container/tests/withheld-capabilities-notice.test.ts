/**
 * THINK-302 U13 (R30): withheld-capability context surfacing.
 */

import { describe, expect, it } from "vitest";
import { formatWithheldCapabilitiesNotice } from "../src/runtime/withheld-capabilities-notice.js";

describe("formatWithheldCapabilitiesNotice", () => {
  it("renders nothing when there are no withheld entries", () => {
    expect(formatWithheldCapabilitiesNotice([])).toBe("");
    expect(formatWithheldCapabilitiesNotice(null)).toBe("");
    expect(formatWithheldCapabilitiesNotice(undefined)).toBe("");
  });

  it("renders a drifted skill with a pending-re-approval remedy hint", () => {
    const notice = formatWithheldCapabilitiesNotice([
      { slug: "market-report", class: "skill", reason: "definition_drift" },
    ]);
    expect(notice).toContain("market-report");
    expect(notice).toContain("definition_drift");
    expect(notice).toContain("pending re-approval");
    expect(notice).toContain("do NOT");
  });

  it("skips entries missing a slug or reason rather than rendering blanks", () => {
    const notice = formatWithheldCapabilitiesNotice([
      { class: "tool" },
      { slug: "ok", reason: "unsigned" },
      { slug: "no-reason" },
    ]);
    expect(notice).toContain("ok: unsigned");
    expect(notice).not.toContain("no-reason");
    expect(notice.split("\n").filter((l) => l.startsWith("- ")).length).toBe(1);
  });

  it("caps entries and appends an overflow tally", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      slug: `cap-${i}`,
      class: "tool",
      reason: "unsigned",
    }));
    const notice = formatWithheldCapabilitiesNotice(many);
    const bulletLines = notice.split("\n").filter((l) => l.startsWith("- "));
    // 12 shown + 1 overflow line
    expect(bulletLines.length).toBe(13);
    expect(notice).toContain("and 8 more withheld capabilities");
  });

  it("falls back to a generic hint for an unknown reason", () => {
    const notice = formatWithheldCapabilitiesNotice([
      { slug: "x", class: "mcp", reason: "some_future_reason" },
    ]);
    expect(notice).toContain("some_future_reason");
    expect(notice).toContain("unavailable this turn");
  });
});
