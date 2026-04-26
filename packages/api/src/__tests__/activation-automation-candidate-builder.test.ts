import { describe, expect, it } from "vitest";

import {
  buildActivationAutomationCandidateRows,
  inferActivationAutomationSchedule,
} from "../graphql/resolvers/activation/generateActivationAutomationCandidates.mutation.js";

describe("activation automation candidate builder", () => {
  it("builds personal agent candidates from scheduled activation entries", () => {
    const rows = buildActivationAutomationCandidateRows(
      {
        id: "session-1",
        tenant_id: "tenant-1",
        user_id: "user-1",
        layer_states: {
          rhythms: {
            entries: [
              {
                title: "Monday planning",
                summary: "Review priorities every Monday morning.",
                cadence: "weekly",
              },
            ],
          },
        },
      },
      "agent-1",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      session_id: "session-1",
      tenant_id: "tenant-1",
      user_id: "user-1",
      target_type: "agent",
      target_agent_id: "agent-1",
      trigger_type: "agent_scheduled",
      schedule_expression: "cron(0 9 ? * MON *)",
      status: "generated",
    });
  });

  it("skips malformed entries and unsupported schedule expressions", () => {
    const rows = buildActivationAutomationCandidateRows(
      {
        id: "session-1",
        tenant_id: "tenant-1",
        user_id: "user-1",
        layer_states: {
          rhythms: {
            entries: [
              null,
              "not-an-object",
              { title: "Bad schedule", scheduleExpression: "every morning" },
              {
                title: "Tentative daily review",
                cadence: "daily",
                epistemicState: "tentative",
              },
              { title: "Daily review", cadence: "daily" },
            ],
          },
        },
      },
      "agent-1",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Daily review");
  });

  it("recognizes explicit cron or rate schedule expressions only", () => {
    expect(
      inferActivationAutomationSchedule({
        scheduleExpression: " cron(0 9 * * ? *) ",
        timezone: "America/Chicago",
      }),
    ).toEqual({
      expression: "cron(0 9 * * ? *)",
      timezone: "America/Chicago",
    });
    expect(
      inferActivationAutomationSchedule({
        scheduleExpression: "rate(1 day)",
      }),
    ).toEqual({
      expression: "rate(1 day)",
      timezone: "UTC",
    });
    expect(
      inferActivationAutomationSchedule({
        scheduleExpression: "tomorrow at 9",
      }),
    ).toBeNull();
  });
});
