import { describe, expect, it, vi } from "vitest";

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({ execute: vi.fn() }),
}));

import {
  DEFAULT_MAX_DELETES,
  FIXTURE_PATTERN,
  parseArgs,
} from "./quarantine-eval-residue.js";

const fixtureRe = new RegExp(FIXTURE_PATTERN, "i");

describe("quarantine-eval-residue", () => {
  it("matches known synthetic fixture shapes", () => {
    expect(
      fixtureRe.test(
        "User memory: my user orbit checksum 8a9a4d57 is UserMarkerff3cbac6.",
      ),
    ).toBe(true);
    expect(
      fixtureRe.test(
        "Space memory: the shared space orbit checksum 04ae96eb is SpaceMarkerde0d3a6a.",
      ),
    ).toBe(true);
    expect(fixtureRe.test("UserMarker66f5fa81")).toBe(true);
  });

  it("leaves real memories alone", () => {
    expect(
      fixtureRe.test("Birdie is Eric's poodle and her favorite toy is Orbit."),
    ).toBe(false);
    expect(
      fixtureRe.test("The deploy checksum verification step passed."),
    ).toBe(false);
    expect(
      fixtureRe.test("User marker preferences were discussed in the meeting."),
    ).toBe(false);
  });

  it("parses args with dry-run default and requires stage", () => {
    expect(parseArgs(["--stage", "dev"])).toEqual({
      stage: "dev",
      dryRun: true,
      maxDeletes: DEFAULT_MAX_DELETES,
    });
    expect(parseArgs(["--stage", "dev", "--dry-run=false"]).dryRun).toBe(false);
    expect(parseArgs(["--stage", "dev", "--bank", "user_x"]).bankId).toBe(
      "user_x",
    );
    expect(() => parseArgs([])).toThrow(/--stage is required/);
    expect(() => parseArgs(["--stage", "dev", "--bogus"])).toThrow(
      /Unknown argument/,
    );
  });
});
