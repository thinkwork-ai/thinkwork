import { describe, expect, it, vi } from "vitest";

import {
  assertLocalAuthRetirementSupported,
  buildControllerDeployInput,
  buildLocalDeployExecutionSteps,
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
    // The state machine resolves $.terraformModuleVersion via JsonPath — a
    // payload without it fails the execution before CodeBuild starts.
    expect(payload.terraformModuleVersion).toBe("0.1.0-canary.134");
    expect(payload.authRetirementPhase).toBeUndefined();
    expect(payload.finalizeAuthRetirement).toBe(false);
    // The runner reads runner secrets only from this field; without it the
    // stage's configured secrets (domain gates, adminEmail) are ignored.
    expect(payload.runnerSecretArn).toBe(
      "/thinkwork/dev/deployment/runner-secrets",
    );
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
      slack: false,
      stripe: false,
      twenty: false,
    });
    expect(JSON.stringify(payload)).not.toContain("password");
  });

  it("honors an explicit terraform module version override", () => {
    const payload = buildControllerDeployInput({
      action: "update",
      stage: "dev",
      accountId: "123456789012",
      region: "us-east-1",
      releaseVersion: "v0.1.0-canary.134",
      manifestUrl: "https://example.com/thinkwork-release.json",
      manifestSha256: "a".repeat(64),
      terraformModuleVersion: "0.1.0-canary.130",
      sessionId: "cli-dev-20260609T100000Z",
    });
    expect(payload.terraformModuleVersion).toBe("0.1.0-canary.130");
  });

  it("builds a web-only controller input that skips Terraform planning", () => {
    const payload = buildControllerDeployInput({
      action: "web",
      stage: "dev",
      accountId: "123456789012",
      region: "us-east-1",
      releaseVersion: "v0.1.0-canary.201",
      manifestUrl: "https://example.com/thinkwork-release.json",
      manifestSha256: "b".repeat(64),
      sessionId: "cli-dev-web-20260618T100000Z",
    });

    expect(payload.action).toBe("web");
    expect(payload.phase).toBe("web");
    expect(payload.operation).toEqual({
      kind: "web",
      action: "web",
      plan: false,
      apply: true,
      destroy: false,
    });
    expect(payload.evidence.prefix).toBe(
      "sessions/cli-dev-web-20260618T100000Z/web",
    );
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

  it("rejects auth retirement finalization on the unsupported controller path", async () => {
    const controllerDeploy = vi.fn();

    await expect(
      runDeployCommand(
        {
          component: "all",
          controller: true,
          finalizeAuthRetirement: true,
        } as DeployCommandOptions,
        { controllerDeploy },
      ),
    ).rejects.toThrow(/not supported by deploy --controller/);

    expect(controllerDeploy).not.toHaveBeenCalled();
  });
});

describe("local deploy execution ordering", () => {
  it("rejects finalization for non-scaffolded local layouts", () => {
    expect(() =>
      assertLocalAuthRetirementSupported({
        requested: true,
        scaffolded: false,
        hasCaller: true,
        tiers: ["foundation", "data", "app"],
        retirementPhase: "retired",
      }),
    ).toThrow(/requires a scaffolded local deployment/);
  });

  it("rejects finalization when the app retirement tier is omitted", () => {
    expect(() =>
      assertLocalAuthRetirementSupported({
        requested: true,
        scaffolded: true,
        hasCaller: true,
        tiers: ["data"],
        retirementPhase: "retired",
      }),
    ).toThrow(/requires component app or all/);
  });

  it("rejects finalization until the deployed auth phase is retired", () => {
    expect(() =>
      assertLocalAuthRetirementSupported({
        requested: true,
        scaffolded: true,
        hasCaller: true,
        tiers: ["foundation", "data", "app"],
        retirementPhase: "cutover",
      }),
    ).toThrow(/auth_retirement_phase to be retired/);
  });

  it("applies additive schema after data and before app", () => {
    expect(
      buildLocalDeployExecutionSteps(
        ["foundation", "data", "app"],
        true,
        false,
      ),
    ).toEqual([
      { kind: "terraform", tier: "foundation" },
      { kind: "terraform", tier: "data" },
      { kind: "schema", retirement: false },
      { kind: "terraform", tier: "app" },
    ]);
  });

  it("defers irreversible retirement until native reconciliation succeeds", () => {
    expect(
      buildLocalDeployExecutionSteps(["foundation", "data", "app"], true, true),
    ).toEqual([
      { kind: "terraform", tier: "foundation" },
      { kind: "terraform", tier: "data" },
      { kind: "schema", retirement: false },
      { kind: "terraform", tier: "app" },
    ]);
  });

  it("applies schema before an app-only update", () => {
    expect(buildLocalDeployExecutionSteps(["app"], true, false)).toEqual([
      { kind: "schema", retirement: false },
      { kind: "terraform", tier: "app" },
    ]);
  });

  it("applies schema after a data-only update", () => {
    expect(buildLocalDeployExecutionSteps(["data"], true, false)).toEqual([
      { kind: "terraform", tier: "data" },
      { kind: "schema", retirement: false },
    ]);
  });
});

import { buildRuntimeConfig } from "../src/commands/deploy.js";

describe("buildRuntimeConfig (HCI test — stage-agnostic web bundle)", () => {
  it("mirrors the controller runner's runtime_profile shape", () => {
    const config = buildRuntimeConfig({
      stage: "hci",
      region: "us-east-1",
      accountId: "424337058806",
      releaseVersion: "0.12.15",
      apiEndpoint: "https://abc.execute-api.us-east-1.amazonaws.com/",
      appUrl: "https://hci.thinkwork.ai",
      authDomain: "thinkwork-hci",
      appsyncUrl: "https://xyz.appsync-api.us-east-1.amazonaws.com/graphql",
      appsyncRealtimeUrl:
        "wss://xyz.appsync-realtime-api.us-east-1.amazonaws.com/graphql",
      appsyncApiKey: "da2-key",
      userPoolId: "us-east-1_ABC",
      adminClientId: "client123",
      issuedAt: "2026-07-02T00:00:00.000Z",
    });
    expect(config.graphqlHttpUrl).toBe(
      "https://abc.execute-api.us-east-1.amazonaws.com/graphql",
    );
    expect(config.cognitoDomain).toBe(
      "https://thinkwork-hci.auth.us-east-1.amazoncognito.com",
    );
    expect(config.cognitoClientId).toBe("client123");
    expect(config.deploymentId).toBe("thinkwork-hci");
    expect(config.controller).toBeNull();
    const viteEnv = config.viteEnv as Record<string, string>;
    expect(viteEnv.VITE_COGNITO_CLIENT_ID).toBe("client123");
    expect(viteEnv.VITE_GRAPHQL_WS_URL).toContain("appsync-realtime");
    expect(viteEnv.VITE_STAGE).toBe("hci");
  });

  it("passes through already-https cognito domains and empty endpoints", () => {
    const config = buildRuntimeConfig({
      stage: "x",
      region: "us-east-1",
      accountId: "1",
      releaseVersion: null,
      apiEndpoint: "",
      appUrl: "",
      authDomain: "https://custom.auth.example.com",
      appsyncUrl: "",
      appsyncRealtimeUrl: "",
      appsyncApiKey: "",
      userPoolId: "",
      adminClientId: "",
      issuedAt: "2026-07-02T00:00:00.000Z",
    });
    expect(config.cognitoDomain).toBe("https://custom.auth.example.com");
    expect(config.graphqlHttpUrl).toBe("");
  });
});
