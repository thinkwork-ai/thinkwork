import { describe, expect, it } from "vitest";
import { buildExpression } from "./SchedulePicker";

describe("buildExpression", () => {
  it("does not throw while one-time schedules are missing a datetime", () => {
    expect(
      buildExpression({
        scheduleType: "one_time",
        useCustom: false,
        customExpr: "",
        selectedFreq: "rate(7 days)",
        hour: 8,
        amPm: "AM",
        oneTimeDate: "",
      }),
    ).toEqual({ type: "at", expr: "" });
  });
});
