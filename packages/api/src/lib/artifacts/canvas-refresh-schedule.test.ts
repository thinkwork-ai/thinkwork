import { describe, expect, it } from "vitest";
import {
  CANVAS_REFRESH_MIN_INTERVAL_MINUTES,
  CANVAS_REFRESH_SENTINEL_DEFAULT_COOLDOWN_MINUTES,
  CANVAS_REFRESH_SENTINEL_DEFAULT_MODE,
  CANVAS_REFRESH_TRIGGER_TYPE,
  createCanvasRefreshSchedule,
  normalizeSentinelConfig,
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

describe("normalizeSentinelConfig — sentinel threading (THINK-233)", () => {
  it("returns null for an absent sentinel (refresh-only schedule)", () => {
    expect(normalizeSentinelConfig(undefined)).toBeNull();
    expect(normalizeSentinelConfig(null)).toBeNull();
  });

  it("returns null for a disabled sentinel (stored as nothing)", () => {
    expect(normalizeSentinelConfig({ enabled: false })).toBeNull();
  });

  it("defaults mode + cooldown when only enabled is set", () => {
    expect(normalizeSentinelConfig({ enabled: true })).toEqual({
      enabled: true,
      mode: CANVAS_REFRESH_SENTINEL_DEFAULT_MODE,
      cooldownMinutes: CANVAS_REFRESH_SENTINEL_DEFAULT_COOLDOWN_MINUTES,
    });
  });

  it("floors the cooldown and trims the prompt", () => {
    expect(
      normalizeSentinelConfig({
        enabled: true,
        mode: "any_change",
        cooldownMinutes: 30.9,
        prompt: "  Focus on revenue widgets.  ",
      }),
    ).toEqual({
      enabled: true,
      mode: "any_change",
      cooldownMinutes: 30,
      prompt: "Focus on revenue widgets.",
    });
  });

  it("falls back to the default mode for a blank mode and drops a blank prompt", () => {
    expect(
      normalizeSentinelConfig({
        enabled: true,
        mode: "   ",
        prompt: "   ",
        cooldownMinutes: -5,
      }),
    ).toEqual({
      enabled: true,
      mode: CANVAS_REFRESH_SENTINEL_DEFAULT_MODE,
      cooldownMinutes: 0,
    });
  });
});
