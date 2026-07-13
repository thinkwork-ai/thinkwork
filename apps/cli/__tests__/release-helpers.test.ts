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
    });
  });

  it("preserves Hindsight configuration in release updates", () => {
    const prior: PriorControllerInput = {
      customerName: "ThinkWork",
      environmentName: "tei-e2e",
      awsAccountId: "123456789012",
      awsRegion: "us-east-1",
      availabilityZones: [],
      evidenceBucket: "thinkwork-tei-e2e-deploy-evidence",
      agentcorePiSourceImageUri:
        "123456789012.dkr.ecr.us-east-1.amazonaws.com/thinkwork-tei-e2e-agentcore:pinned@sha256:abc",
      enableHindsight: true,
      hindsightDatabaseName: "thinkwork_hindsight",
    };
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
    });

    expect(input).toMatchObject({
      enableHindsight: true,
      hindsightDatabaseName: "thinkwork_hindsight",
      preservedConfig: {
        enableHindsight: true,
        hindsightDatabaseName: "thinkwork_hindsight",
      },
    });
  });
});

describe("recoverPriorControllerInput", () => {
  it("recovers Hindsight fields dropped by an intervening release update", () => {
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
    ]);

    expect(recovered).toMatchObject({
      enableHindsight: true,
      hindsightDatabaseName: "thinkwork_hindsight",
    });
  });

  it("does not override an explicit Hindsight disablement", () => {
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
      { ...required, enableHindsight: false },
      {
        ...required,
        enableHindsight: true,
        hindsightDatabaseName: "thinkwork_hindsight",
      },
    ]);

    expect(recovered.enableHindsight).toBe(false);
  });
});
