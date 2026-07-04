import { describe, expect, it } from "vitest";
import { workItemAgeBucket } from "./age-bucket";

describe("workItemAgeBucket", () => {
  const now = new Date("2026-07-04T12:00:00.000Z");

  it("classifies null due dates", () => {
    expect(workItemAgeBucket(null, now)).toBe("no-due-date");
  });

  it("classifies overdue due dates", () => {
    expect(workItemAgeBucket("2026-07-04T11:59:59.000Z", now)).toBe(
      "overdue",
    );
  });

  it("classifies due-soon dates inside forty-eight hours", () => {
    expect(workItemAgeBucket("2026-07-06T12:00:00.000Z", now)).toBe(
      "due-soon",
    );
  });

  it("classifies later due dates as on-track", () => {
    expect(workItemAgeBucket("2026-07-06T12:00:01.000Z", now)).toBe(
      "on-track",
    );
  });
});
