import { describe, expect, it, vi } from "vitest";

import {
  buildControllerDeployInput,
  controllerStateMachineArn,
  runDeployCommand,
  type DeployCommandOptions,
} from "../src/commands/deploy.js";

describe("deploy controller path", () => {
  it("builds a release-pinned controller input without optional apps", () => {
    const payload = buildControllerDeployInput({
      action: "update",
      stage: "dev",
      accountId: "123456789012",
      region: "us-east-1",
      releaseVersion: "v0.1.0-canary.134",
      manifestUrl:
        "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.134/thinkwork-release.json",
      manifestSha256: "a".repeat(64),
      sessionId: "cli-dev-20260609T100000Z",
    });

    expect(payload).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        contract: "thinkwork.deployment.controller.v1",
        phase: "update",
        action: "update",
        sessionId: "cli-dev-20260609T100000Z",
        environmentName: "dev",
        awsAccountId: "123456789012",
        awsRegion: "us-east-1",
        releaseVersion: "v0.1.0-canary.134",
      }),
    );
    expect(payload.release).toEqual({
      version: "v0.1.0-canary.134",
      manifestUrl:
        "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.134/thinkwork-release.json",
      manifestSha256: "a".repeat(64),
    });
    expect(payload.evidence).toEqual(
      expect.objectContaining({
        bucket: "thinkwork-dev-123456789012-deploy-evidence",
        prefix: "sessions/cli-dev-20260609T100000Z/update",
        expectedArtifacts: expect.arrayContaining([
          "controller-input-summary.json",
          "redacted-terraform-vars.json",
          "terraform-plan.json",
          "terraform-outputs.json",
          "deployment-evidence.json",
        ]),
      }),
    );
    expect(payload.features.baseInstall).toEqual({
      cognee: false,
      slack: false,
      stripe: false,
      twenty: false,
    });
    expect(JSON.stringify(payload)).not.toContain("password");
  });

  it("derives the conventional deployment state machine ARN", () => {
    expect(
      controllerStateMachineArn({
        stage: "dev",
        region: "us-east-1",
        accountId: "123456789012",
      }),
    ).toBe(
      "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-deployment-orchestrator",
    );
  });

  it("routes deploy --controller to the controller runner", async () => {
    const controllerDeploy = vi.fn().mockResolvedValue({
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-deployment-orchestrator",
      executionArn:
        "arn:aws:states:us-east-1:123456789012:execution:thinkwork-dev-deployment-orchestrator:tw-cli",
      payload: {},
    });
    const localDeploy = vi.fn();

    await runDeployCommand(
      {
        component: "all",
        controller: true,
      } as DeployCommandOptions,
      { controllerDeploy, localDeploy },
    );

    expect(controllerDeploy).toHaveBeenCalledTimes(1);
    expect(localDeploy).not.toHaveBeenCalled();
  });
});
