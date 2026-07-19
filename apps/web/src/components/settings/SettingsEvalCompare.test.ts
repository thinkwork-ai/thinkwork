import { describe, expect, it } from "vitest";

import {
  comparabilityFlags,
  parseProfileSnapshot,
  pinnedRunConfigLabel,
} from "./SettingsEvalCompare";

function detail(overrides: Record<string, unknown> = {}) {
  return {
    datasetVersion: 3,
    scoringVersion: 3,
    status: "completed",
    profileSnapshot: JSON.stringify({
      runtimeType: "pi",
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
      runtimeType: null,
      judgeModel: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      workspaceFingerprint: ["a", "b"],
      tierCounts: null,
    });
    expect(parseProfileSnapshot(null)).toEqual({
      runtimeType: null,
      judgeModel: null,
      workspaceFingerprint: null,
      tierCounts: null,
    });
    expect(parseProfileSnapshot("not json")).toEqual({
      runtimeType: null,
      judgeModel: null,
      workspaceFingerprint: null,
      tierCounts: null,
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

  it("flags Pi and AgentCore Harness runs as non-comparable", () => {
    const agentcore = detail({
      profileSnapshot: JSON.stringify({
        runtimeType: "agentcore",
        judgeModel: null,
        workspaceFingerprint: ["skill-a"],
      }),
    });
    expect(
      comparabilityFlags([detail(), agentcore]).some((flag) =>
        flag.includes("Execution runtimes differ"),
      ),
    ).toBe(true);
  });

  it("fewer than two runs never flags — the empty/single states carry guidance instead", () => {
    expect(comparabilityFlags([detail()])).toEqual([]);
    expect(comparabilityFlags([])).toEqual([]);
  });
});

describe("pinned run labels", () => {
  it("renders the immutable run runtime and model rather than the editable profile", () => {
    expect(
      pinnedRunConfigLabel({
        runtimeType: "agentcore",
        model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      }),
    ).toContain("AgentCore Harness");
    expect(
      pinnedRunConfigLabel({ runtimeType: "pi", model: "claude-haiku-4-5" }),
    ).toContain("Pi");
  });
});

describe("tier-mix drift (Eval Execution Tiers v1)", () => {
  it("flags runs whose execution tier mixes differ; identical mixes stay clean", () => {
    const tiered = (model: number, agent: number) =>
      detail({
        profileSnapshot: JSON.stringify({
          judgeModel: null,
          workspaceFingerprint: ["skill-a"],
          tierCounts: { model, agent },
        }),
      });
    expect(
      comparabilityFlags([tiered(150, 39), tiered(0, 189)]).some((f) =>
        f.includes("Execution tiers differ"),
      ),
    ).toBe(true);
    expect(
      comparabilityFlags([tiered(150, 39), tiered(150, 39)]).some((f) =>
        f.includes("Execution tiers differ"),
      ),
    ).toBe(false);
    // A pre-tier run vs a tiered run also flags.
    expect(
      comparabilityFlags([detail(), tiered(150, 39)]).some((f) =>
        f.includes("Execution tiers differ"),
      ),
    ).toBe(true);
  });
});
