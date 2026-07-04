import { describe, expect, it } from "vitest";
import {
  CANVAS_REFRESH_MIN_INTERVAL_MINUTES,
  CANVAS_REFRESH_TRIGGER_TYPE,
  createCanvasRefreshSchedule,
} from "./canvas-refresh-schedule.js";

describe("createCanvasRefreshSchedule — interval floor (U7)", () => {
  it("exposes a 15-minute floor and the canvas_refresh trigger type", () => {
    expect(CANVAS_REFRESH_MIN_INTERVAL_MINUTES).toBe(15);
    expect(CANVAS_REFRESH_TRIGGER_TYPE).toBe("canvas_refresh");
  });

  it("rejects an interval below the floor BEFORE any DB write", async () => {
    await expect(
      createCanvasRefreshSchedule({
        tenantId: "t1",
        artifactId: "a1",
        intervalMinutes: 5,
      }),
    ).rejects.toThrow(/at least 15 minutes/);
  });

  it("rejects a non-finite interval", async () => {
    await expect(
      createCanvasRefreshSchedule({
        tenantId: "t1",
        artifactId: "a1",
        intervalMinutes: Number.NaN,
      }),
    ).rejects.toThrow(/at least 15 minutes/);
  });
});
