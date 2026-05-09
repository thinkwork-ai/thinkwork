import { describe, expect, it } from "vitest";
import { buildRefreshedDashboardManifest } from "../lib/dashboard-artifacts/refresh-executor.js";
import { validManifest } from "./dashboard-artifacts-manifest.test.js";

describe("dashboard artifact refresh executor", () => {
  it("updates refresh timestamps without changing the saved recipe", () => {
    const manifest = validManifest();
    const refreshed = buildRefreshedDashboardManifest(
      manifest,
      new Date("2026-05-09T01:02:03.000Z"),
    );

    expect(refreshed.manifest.recipe).toEqual(manifest.recipe);
    expect(refreshed.manifest.refresh).toMatchObject({
      lastRefreshAt: "2026-05-09T01:02:03.000Z",
      nextAllowedAt: "2026-05-09T01:07:03.000Z",
    });
    expect(refreshed.manifest.sources.every((source) => source.asOf)).toBe(
      true,
    );
    expect(refreshed.output).toMatchObject({
      refreshed: true,
      deterministic: true,
      artifactId: "artifact-1",
      recipeId: "recipe-1",
      recipeVersion: 1,
      refreshedAt: "2026-05-09T01:02:03.000Z",
    });
  });
});
