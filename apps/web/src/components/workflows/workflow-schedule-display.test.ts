import { describe, expect, it } from "vitest";
import { formatWorkflowSchedule } from "./workflow-schedule-display";

describe("formatWorkflowSchedule", () => {
  it("describes daily schedules in their configured timezone", () => {
    expect(formatWorkflowSchedule("cron(0 6 * * ? *)", "America/Chicago")).toBe(
      "Daily at 6:00 AM · America/Chicago",
    );
  });

  it("describes weekday, weekly, and hourly schedules", () => {
    expect(formatWorkflowSchedule("cron(0 9 ? * MON-FRI *)", "UTC")).toBe(
      "Weekdays at 9:00 AM · UTC",
    );
    expect(formatWorkflowSchedule("cron(30 14 ? * FRI *)", "UTC")).toBe(
      "Weekly on Friday at 2:30 PM · UTC",
    );
    expect(formatWorkflowSchedule("rate(1 hour)", "UTC")).toBe("Hourly · UTC");
  });

  it("preserves custom expressions instead of mistranslating them", () => {
    expect(formatWorkflowSchedule("cron(15 6 1 * ? *)", "UTC")).toBe(
      "cron(15 6 1 * ? *)",
    );
    expect(
      formatWorkflowSchedule("rate(30 minutes)", "UTC", {
        customLabel: "Custom",
      }),
    ).toBe("Custom");
  });

  it("treats an empty expression as manual", () => {
    expect(formatWorkflowSchedule("", "UTC")).toBe("Manual");
  });
});
