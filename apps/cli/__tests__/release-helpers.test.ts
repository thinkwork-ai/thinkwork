import { describe, expect, it } from "vitest";

import {
  buildControllerUpdateInput,
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
});
