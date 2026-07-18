import { describe, expect, it } from "vitest";
import {
  harnessManagedProfileParameterName,
  parseHarnessManagedProfile,
  readHarnessReadiness,
} from "./managed-profile.js";

const profile = JSON.stringify({
  tenantSlug: "sleek-squirrel-230",
  harnessArn:
    "arn:aws:bedrock-agentcore:us-east-1:123:harness/Thinkwork_dev_tenant_default-abc",
  endpointName: "ThinkworkProof",
  expectedVersion: "4",
  liveVersion: "4",
  modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  status: "ready",
  configurationFingerprint: "a".repeat(64),
  sessionStrategy: "fresh",
  gatewayUrl: "https://gateway.example.com/mcp",
  gatewayTargetName: "ThinkworkDevOwnerProof",
  identityWorkloadName: "thinkwork-dev-multiplayer-proof",
  identityCredentialProviderName: "thinkwork-dev-proof-oauth",
});

function deps(value: string | null, stage = "dev") {
  return {
    stage,
    getParameter: async () => value,
  };
}

describe("managed AgentCore Harness profile", () => {
  it("uses a deterministic tenant-scoped SSM address", () => {
    expect(
      harnessManagedProfileParameterName("dev", "sleek-squirrel-230"),
    ).toBe("/thinkwork/dev/agentcore-harness-profiles/sleek-squirrel-230");
  });

  it("falls back to the deployed legacy profile during rollout", async () => {
    const requested: string[] = [];
    const result = await readHarnessReadiness("sleek-squirrel-230", {
      stage: "dev",
      async getParameter(name) {
        requested.push(name);
        return requested.length === 1 ? null : profile;
      },
    });
    expect(requested).toEqual([
      "/thinkwork/dev/agentcore-harness-profiles/sleek-squirrel-230",
      "/thinkwork/dev/agentcore-harness-proof-profile",
    ]);
    expect(result).toMatchObject({ ready: true, reasonCode: "ready" });
  });

  it("accepts the enrolled tenant only when the named version is attested", async () => {
    const result = await readHarnessReadiness(
      "sleek-squirrel-230",
      deps(profile),
    );
    expect(result).toMatchObject({
      state: "ready",
      ready: true,
      reasonCode: "ready",
      expectedVersion: "4",
      liveVersion: "4",
      modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      sessionStrategy: "fresh",
    });
  });

  it("fails closed when a tenant resolves another tenant's profile", async () => {
    await expect(
      readHarnessReadiness("another-tenant", deps(profile)),
    ).resolves.toMatchObject({
      state: "disabled",
      ready: false,
      reasonCode: "profile_tenant_mismatch",
    });
  });

  it("fails closed when the endpoint version drifts", async () => {
    const drifted = profile.replace('"liveVersion":"4"', '"liveVersion":"5"');
    await expect(
      readHarnessReadiness("sleek-squirrel-230", deps(drifted)),
    ).resolves.toMatchObject({
      state: "drifted",
      ready: false,
      reasonCode: "endpoint_version_drift",
    });
  });

  it("supports the managed profile in production", async () => {
    await expect(
      readHarnessReadiness("sleek-squirrel-230", deps(profile, "prod")),
    ).resolves.toMatchObject({
      state: "ready",
      ready: true,
      reasonCode: "ready",
    });
  });

  it("fails closed without a trusted tenant identity", async () => {
    await expect(
      readHarnessReadiness("", deps(profile)),
    ).resolves.toMatchObject({
      state: "misconfigured",
      ready: false,
      reasonCode: "tenant_identity_missing",
    });
  });

  it("rejects malformed profiles without exposing their content", () => {
    expect(() => parseHarnessManagedProfile('{"status":"ready"}')).toThrow(
      /missing tenantSlug/,
    );
  });
});
