import { describe, expect, it } from "vitest";
import {
  parseHarnessProofProfile,
  readHarnessProofReadiness,
} from "./proof-profile.js";

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

describe("Harness proof profile", () => {
  it("accepts the enrolled tenant only when the named version is attested", async () => {
    const result = await readHarnessProofReadiness(
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

  it("keeps a different tenant disabled", async () => {
    await expect(
      readHarnessProofReadiness("another-tenant", deps(profile)),
    ).resolves.toMatchObject({
      state: "disabled",
      ready: false,
      reasonCode: "tenant_not_enrolled",
    });
  });

  it("fails closed when the endpoint version drifts", async () => {
    const drifted = profile.replace('"liveVersion":"4"', '"liveVersion":"5"');
    await expect(
      readHarnessProofReadiness("sleek-squirrel-230", deps(drifted)),
    ).resolves.toMatchObject({
      state: "drifted",
      ready: false,
      reasonCode: "endpoint_version_drift",
    });
  });

  it("is always disabled in production even if a profile exists", async () => {
    await expect(
      readHarnessProofReadiness("sleek-squirrel-230", deps(profile, "prod")),
    ).resolves.toMatchObject({
      state: "disabled",
      ready: false,
      reasonCode: "production_disabled",
    });
  });

  it("rejects malformed profiles without exposing their content", () => {
    expect(() => parseHarnessProofProfile('{"status":"ready"}')).toThrow(
      /missing tenantSlug/,
    );
  });
});
