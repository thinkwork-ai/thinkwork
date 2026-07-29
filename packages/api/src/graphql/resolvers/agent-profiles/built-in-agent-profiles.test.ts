import { describe, expect, it } from "vitest";
import { BUILT_IN_PROFILE_SEEDS } from "./built-in-agent-profiles.js";

describe("built-in agent profile seeds (U15 — R20)", () => {
  it("no seeded prompt references the retired connections/ workspace folder", () => {
    for (const seed of BUILT_IN_PROFILE_SEEDS) {
      const text = JSON.stringify(seed);
      expect(text).not.toContain("connections/");
    }
  });

  it("the analyst seed no longer references a registered data source", () => {
    const analyst = BUILT_IN_PROFILE_SEEDS.find(
      (seed) => seed.built_in_key === "analyst",
    );
    expect(analyst).toBeDefined();
    // The analyst data-source subsystem is retired (Company Brain replaces
    // it); the profile works from uploaded files and tool results instead.
    const text = JSON.stringify(analyst);
    expect(text).not.toContain("SCHEMA.md");
    expect(text).not.toContain("postgres-dev");
  });
});
