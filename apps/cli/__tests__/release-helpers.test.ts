import { describe, expect, it } from "vitest";

import {
  buildControllerUpdateInput,
  recoverPriorControllerInput,
  type PriorControllerInput,
  type ResolvedReleaseManifest,
} from "../src/commands/release/helpers.js";

describe("buildControllerUpdateInput", () => {
  it("sends the release-following module source for older customer controllers", () => {
    const prior: PriorControllerInput = {
      customerName: "ThinkWork",
      environmentName: "tei-e2e",
      awsAccountId: "123456789012",
      awsRegion: "us-east-1",
      availabilityZones: [],
      evidenceBucket: "thinkwork-tei-e2e-deploy-evidence",
      agentcorePiSourceImageUri:
        "123456789012.dkr.ecr.us-east-1.amazonaws.com/thinkwork-tei-e2e-agentcore:pinned@sha256:abc",
    };
    const release: ResolvedReleaseManifest = {
      version: "v0.1.0-canary.270",
      manifestUrl:
        "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.270/thinkwork-release.json",
      manifestSha256: "abc123",
    };

    const input = buildControllerUpdateInput({
      prior,
      release,
      sessionId: "session-1",
    });

    expect(input).toMatchObject({
      terraformModuleSource: "thinkwork-ai/thinkwork/aws",
      terraformModuleVersion: "0.1.0-canary.270",
      finalizeAuthRetirement: false,
    });
    expect(input.authRetirementPhase).toBeUndefined();
  });

  it("preserves the retirement phase without allowing release finalization", () => {
    const prior: PriorControllerInput = {
      customerName: "ThinkWork",
      environmentName: "tei-e2e",
      awsAccountId: "123456789012",
      awsRegion: "us-east-1",
      availabilityZones: [],
      evidenceBucket: "thinkwork-tei-e2e-deploy-evidence",
      agentcorePiSourceImageUri:
        "123456789012.dkr.ecr.us-east-1.amazonaws.com/thinkwork-tei-e2e-agentcore:pinned@sha256:abc",
      authRetirementPhase: "retired",
    };
    const release: ResolvedReleaseManifest = {
      version: "v0.1.0-canary.271",
      manifestUrl:
        "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.271/thinkwork-release.json",
      manifestSha256: "abc123",
    };

    expect(
      buildControllerUpdateInput({ prior, release, sessionId: "session-2" }),
    ).toMatchObject({
      authRetirementPhase: "retired",
      finalizeAuthRetirement: false,
    });
  });

  it("drops the retired Hindsight keys instead of carrying them forward", () => {
    const prior = {
      customerName: "ThinkWork",
      environmentName: "tei-e2e",
      awsAccountId: "123456789012",
      awsRegion: "us-east-1",
      availabilityZones: [],
      evidenceBucket: "thinkwork-tei-e2e-deploy-evidence",
      agentcorePiSourceImageUri:
        "123456789012.dkr.ecr.us-east-1.amazonaws.com/thinkwork-tei-e2e-agentcore:pinned@sha256:abc",
      // THINK-407: a stage whose last successful input still carries these
      // must keep deploying — they are simply ignored.
      enableHindsight: true,
      hindsightDatabaseName: "thinkwork_hindsight",
    } as unknown as PriorControllerInput;
    const release: ResolvedReleaseManifest = {
      version: "v0.1.0-canary.355",
      manifestUrl:
        "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.355/thinkwork-release.json",
      manifestSha256: "abc123",
    };

    const input = buildControllerUpdateInput({
      prior,
      release,
      sessionId: "session-hindsight",
    }) as Record<string, unknown>;

    expect(input.enableHindsight).toBeUndefined();
    expect(input.hindsightDatabaseName).toBeUndefined();
    const preserved = (input.preservedConfig ?? {}) as Record<string, unknown>;
    expect(preserved.enableHindsight).toBeUndefined();
    expect(preserved.hindsightDatabaseName).toBeUndefined();
  });
});

describe("recoverPriorControllerInput", () => {
  it("ignores retired Hindsight keys in older successful inputs", () => {
    const required = {
      customerName: "ThinkWork",
      environmentName: "tei-e2e",
      awsAccountId: "123456789012",
      awsRegion: "us-east-1",
      availabilityZones: [],
      evidenceBucket: "thinkwork-tei-e2e-deploy-evidence",
      agentcorePiSourceImageUri:
        "123456789012.dkr.ecr.us-east-1.amazonaws.com/thinkwork-tei-e2e-agentcore:pinned@sha256:abc",
    };

    const recovered = recoverPriorControllerInput([
      required,
      {
        ...required,
        enableHindsight: true,
        hindsightDatabaseName: "thinkwork_hindsight",
      },
    ]) as Record<string, unknown>;

    expect(recovered.enableHindsight).toBeUndefined();
    expect(recovered.hindsightDatabaseName).toBeUndefined();
    expect(recovered.agentcorePiSourceImageUri).toBe(
      required.agentcorePiSourceImageUri,
    );
  });
});
