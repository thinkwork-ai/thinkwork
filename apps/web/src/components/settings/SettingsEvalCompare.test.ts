import { describe, expect, it } from "vitest";

import {
  comparabilityFlags,
  parseProfileSnapshot,
} from "./SettingsEvalCompare";

function detail(overrides: Record<string, unknown> = {}) {
  return {
    datasetVersion: 3,
    scoringVersion: 3,
    status: "completed",
    profileSnapshot: JSON.stringify({
      judgeModel: null,
      workspaceFingerprint: ["skill-a"],
    }),
    ...overrides,
  } as never;
}

describe("parseProfileSnapshot", () => {
  it("extracts judge pin and fingerprint, tolerating null/garbage snapshots", () => {
    expect(
      parseProfileSnapshot(
        JSON.stringify({
          judgeModel: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
          workspaceFingerprint: ["a", "b"],
        }),
      ),
    ).toEqual({
      judgeModel: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      workspaceFingerprint: ["a", "b"],
    });
    expect(parseProfileSnapshot(null)).toEqual({
      judgeModel: null,
      workspaceFingerprint: null,
    });
    expect(parseProfileSnapshot("not json")).toEqual({
      judgeModel: null,
      workspaceFingerprint: null,
    });
  });
});

describe("comparabilityFlags (KTD6 gate)", () => {
  it("identical dataset/scoring/judge/fingerprint completed runs raise no flags", () => {
    expect(comparabilityFlags([detail(), detail()])).toEqual([]);
  });

  it("mismatched dataset versions render the non-comparable flag (Covers AE4)", () => {
    const flags = comparabilityFlags([
      detail({ datasetVersion: 3 }),
      detail({ datasetVersion: 4 }),
    ]);
    expect(flags.some((f) => f.includes("Dataset versions differ"))).toBe(true);
  });

  it("flags scoring-version drift, judge-pin drift, fingerprint drift, and partial runs", () => {
    expect(
      comparabilityFlags([
        detail({ scoringVersion: 2 }),
        detail({ scoringVersion: 3 }),
      ]).some((f) => f.includes("Scoring versions differ")),
    ).toBe(true);

    expect(
      comparabilityFlags([
        detail({
          profileSnapshot: JSON.stringify({
            judgeModel: "judge-a",
            workspaceFingerprint: ["skill-a"],
          }),
        }),
        detail(),
      ]).some((f) => f.includes("Judge pins differ")),
    ).toBe(true);

    expect(
      comparabilityFlags([
        detail({
          profileSnapshot: JSON.stringify({
            judgeModel: null,
            workspaceFingerprint: ["skill-a", "skill-b"],
          }),
        }),
        detail(),
      ]).some((f) => f.includes("Workspace fingerprints differ")),
    ).toBe(true);

    expect(
      comparabilityFlags([detail({ status: "cancelled" }), detail()]).some(
        (f) => f.includes("partial"),
      ),
    ).toBe(true);
  });

  it("fewer than two runs never flags — the empty/single states carry guidance instead", () => {
    expect(comparabilityFlags([detail()])).toEqual([]);
    expect(comparabilityFlags([])).toEqual([]);
  });
});
