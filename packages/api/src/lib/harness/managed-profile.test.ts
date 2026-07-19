import { describe, expect, it } from "vitest";
import {
  fingerprintHarnessInvocationTools,
  harnessManagedProfileParameterName,
  parseHarnessManagedProfile,
  readHarnessReadiness,
} from "./managed-profile.js";

const invocationTools = [
  {
    type: "agentcore_gateway",
    name: "thinkwork_gateway",
    config: {
      agentCoreGateway: {
        gatewayArn:
          "arn:aws:bedrock-agentcore:us-east-1:123456789012:gateway/gateway-1",
        outboundAuth: {
          oauth: {
            providerArn:
              "arn:aws:bedrock-agentcore:us-east-1:123456789012:token-vault/default/oauth2credentialprovider/provider-1",
            scopes: ["gateway:invoke"],
            customParameters: {
              subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
            },
            grantType: "TOKEN_EXCHANGE",
          },
        },
      },
    },
  },
  {
    type: "agentcore_browser",
    name: "browser",
    config: { agentCoreBrowser: {} },
  },
  ...["emit_document", "goal_complete", "submit_skill_draft"].map((name) => ({
    type: "inline_function",
    name,
    config: {
      inlineFunction: {
        description: `${name} governed inline function`,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
    },
  })),
];

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
  gatewayArn:
    "arn:aws:bedrock-agentcore:us-east-1:123456789012:gateway/gateway-1",
  gatewayUrl: "https://gateway.example.com/mcp",
  gatewayTargetName: "ThinkworkDevOwnerProof",
  identityWorkloadName: "thinkwork-dev-multiplayer-proof",
  identityCredentialProviderName: "thinkwork-dev-proof-oauth",
  identityCredentialProviderArn:
    "arn:aws:bedrock-agentcore:us-east-1:123456789012:token-vault/default/oauth2credentialprovider/provider-1",
  invocationToolsContract: "control-plane-attested-full-override-v1",
  invocationToolsFingerprint:
    fingerprintHarnessInvocationTools(invocationTools),
  invocationTools,
});

function deps(value: string | null, stage = "dev") {
  return {
    stage,
    getParameter: async () => value,
  };
}

function profileWithTools(
  tools: unknown[],
  fingerprint = fingerprintHarnessInvocationTools(tools),
): string {
  return JSON.stringify({
    ...JSON.parse(profile),
    invocationToolsFingerprint: fingerprint,
    invocationTools: tools,
  });
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

  it("keeps the previous profile revision usable while SSM is upgraded", async () => {
    const legacy = JSON.parse(profile) as Record<string, unknown>;
    delete legacy.gatewayArn;
    delete legacy.identityCredentialProviderArn;
    delete legacy.invocationToolsFingerprint;
    delete legacy.invocationTools;
    delete legacy.invocationToolsContract;

    const result = await readHarnessReadiness(
      "sleek-squirrel-230",
      deps(JSON.stringify(legacy)),
    );

    expect(result).toMatchObject({
      state: "ready",
      ready: true,
      reasonCode: "ready",
      invocationTools: null,
      invocationToolsFingerprint: null,
    });
  });

  it("does not let a partial versioned profile downgrade to legacy tools", () => {
    const partial = JSON.parse(profile) as Record<string, unknown>;
    partial.endpointName = "ThinkworkProofV15";
    delete partial.gatewayArn;
    delete partial.identityCredentialProviderArn;
    delete partial.invocationToolsContract;
    delete partial.invocationToolsFingerprint;
    delete partial.invocationTools;

    expect(() => parseHarnessManagedProfile(JSON.stringify(partial))).toThrow(
      /cannot use legacy tools on a versioned endpoint/,
    );
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
      invocationTools: expect.arrayContaining([
        expect.objectContaining({ name: "thinkwork_gateway" }),
        expect.objectContaining({ name: "browser" }),
        expect.objectContaining({ name: "goal_complete" }),
      ]),
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

  it("fails closed when the attested invocation set omits a governed tool", async () => {
    const missingGoalComplete = profileWithTools(
      JSON.parse(profile).invocationTools.filter(
        (tool: { name: string }) => tool.name !== "goal_complete",
      ),
    );
    await expect(
      readHarnessReadiness("sleek-squirrel-230", deps(missingGoalComplete)),
    ).resolves.toMatchObject({
      state: "misconfigured",
      ready: false,
      reasonCode: "profile_invalid",
    });
  });

  it("rejects the legacy non-canonical Browser tool identity", () => {
    expect(() =>
      parseHarnessManagedProfile(
        profileWithTools(
          invocationTools.map((tool) =>
            tool.name === "browser"
              ? { ...tool, name: "browser_automation" }
              : tool,
          ),
        ),
      ),
    ).toThrow(/invalid invocationTools/);
  });

  it("rejects an unexpected native tool instead of widening capability", () => {
    expect(() =>
      parseHarnessManagedProfile(
        profileWithTools([
          ...invocationTools,
          {
            type: "agentcore_code_interpreter",
            name: "code_interpreter",
            config: { agentCoreCodeInterpreter: {} },
          },
        ]),
      ),
    ).toThrow(/unexpected invocation tools/);
  });

  it("rejects a Browser override that redirects to a different resource", () => {
    expect(() =>
      parseHarnessManagedProfile(
        profileWithTools(
          invocationTools.map((tool) =>
            tool.name === "browser"
              ? {
                  ...tool,
                  config: {
                    agentCoreBrowser: {
                      browserArn:
                        "arn:aws:bedrock-agentcore:us-east-1:123456789012:browser/custom",
                    },
                  },
                }
              : tool,
          ),
        ),
      ),
    ).toThrow(/invalid invocationTools/);
  });

  it("rejects a Gateway override that redirects from the governed resource", () => {
    const redirected = JSON.parse(JSON.stringify(invocationTools)) as Array<{
      name: string;
      config: { agentCoreGateway?: { gatewayArn?: string } };
    }>;
    redirected[0].config.agentCoreGateway!.gatewayArn =
      "arn:aws:bedrock-agentcore:us-east-1:123456789012:gateway/other";
    expect(() =>
      parseHarnessManagedProfile(profileWithTools(redirected)),
    ).toThrow(/do not match governed resources/);
  });

  it("rejects a required inline tool with a drifted schema", () => {
    expect(() =>
      parseHarnessManagedProfile(
        profileWithTools(
          invocationTools.map((tool) =>
            tool.name === "goal_complete"
              ? {
                  ...tool,
                  config: {
                    inlineFunction: {
                      description: "drifted",
                      inputSchema: {
                        type: "object",
                        additionalProperties: true,
                      },
                    },
                  },
                }
              : tool,
          ),
        ),
      ),
    ).toThrow(/invalid invocationTools/);
  });

  it("rejects invocation tools when their canonical fingerprint changes", () => {
    expect(() =>
      parseHarnessManagedProfile(
        profileWithTools(invocationTools, "b".repeat(64)),
      ),
    ).toThrow(/fingerprint mismatch/);
  });
});
