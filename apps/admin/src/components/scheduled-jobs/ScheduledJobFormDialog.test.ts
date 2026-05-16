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

  it("validates that scheduled evals have a running Computer and category", () => {
    expect(
      validateScheduledJobForm(
        { name: "Daily eval", categories: [] },
        EVAL_SCHEDULE_TRIGGER_TYPE,
      ),
    ).toEqual([
      { field: "computerId", message: "Select a running Computer" },
      { field: "categories", message: "Select at least one category" },
    ]);
  });

  it("builds scheduled eval payloads for running Computer ids", () => {
    expect(
      buildScheduledJobPayload(
        {
          name: "Daily computer eval ",
          computerId: "computer-1",
          model: "anthropic.claude-haiku-4-5",
          categories: ["performance-computer"],
        },
        schedule,
        EVAL_SCHEDULE_TRIGGER_TYPE,
      ),
    ).toEqual({
      name: "Daily computer eval",
      trigger_type: "eval_scheduled",
      config: {
        computerId: "computer-1",
        model: "anthropic.claude-haiku-4-5",
        categories: ["performance-computer"],
      },
      schedule_type: "rate",
      schedule_expression: "rate(1 day)",
      timezone: "UTC",
    });
  });
});
