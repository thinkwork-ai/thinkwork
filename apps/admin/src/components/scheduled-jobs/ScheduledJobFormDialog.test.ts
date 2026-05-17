import { describe, expect, it } from "vitest";
import {
  buildScheduledJobPayload,
  EVAL_SCHEDULE_TRIGGER_TYPE,
  resolveInitialTriggerType,
  validateScheduledJobForm,
} from "./ScheduledJobFormDialog";

const schedule = {
  scheduleType: "rate" as const,
  scheduleExpression: "rate(1 day)",
  timezone: "UTC",
};

describe("ScheduledJobFormDialog eval schedule helpers", () => {
  it("defaults to eval scheduling when launched from the eval schedules filter", () => {
    expect(
      resolveInitialTriggerType(undefined, EVAL_SCHEDULE_TRIGGER_TYPE),
    ).toBe(EVAL_SCHEDULE_TRIGGER_TYPE);
  });

  it("validates that scheduled evals have a category", () => {
    expect(
      validateScheduledJobForm(
        { name: "Daily eval", categories: [] },
        EVAL_SCHEDULE_TRIGGER_TYPE,
      ),
    ).toEqual([
      { field: "categories", message: "Select at least one category" },
    ]);
  });

  it("builds scheduled eval payloads for the direct AgentCore default model", () => {
    expect(
      buildScheduledJobPayload(
        {
          name: "Daily red team eval ",
          categories: ["red-team-safety-scope"],
        },
        schedule,
        EVAL_SCHEDULE_TRIGGER_TYPE,
      ),
    ).toEqual({
      name: "Daily red team eval",
      trigger_type: "eval_scheduled",
      config: {
        model: "moonshotai.kimi-k2.5",
        categories: ["red-team-safety-scope"],
      },
      schedule_type: "rate",
      schedule_expression: "rate(1 day)",
      timezone: "UTC",
    });
  });
});
