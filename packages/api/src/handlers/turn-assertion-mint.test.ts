import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildKmsSigningMetric,
  createTurnAssertionMintHandler,
  type TurnAssertionMintDeps,
} from "./turn-assertion-mint.js";

function deps(
  overrides: Partial<TurnAssertionMintDeps> = {},
): TurnAssertionMintDeps {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    issuer: "https://api.example.test/agentcore",
    harnessAudience: "urn:thinkwork:harness:tenant-1",
    gatewayAudience: "urn:thinkwork:gateway:tenant-1",
    keyId: "kms-key-id",
    kid: "kid-2026-07",
    loadTrustedTurn: vi.fn(async () => ({
      tenantId: "tenant-1",
      agentId: "agent-1",
      threadId: "thread-1",
      turnId: "turn-1",
      triggeringMessageId: "message-1",
      participantId: "alice",
      sessionGeneration: 3,
      spaceId: "space-1",
      runtimeType: "harness",
      status: "running",
    })),
    sign: vi.fn(async (message) =>
      sign("RSA-SHA256", Buffer.from(message), privateKey),
    ),
    nowSeconds: () => 1_700_000_000,
    newJti: () => "jti-1",
    ...overrides,
  };
}

function decodePayload(token: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

describe("turn-assertion-mint handler", () => {
  it("builds redacted KMS latency and failure evidence", () => {
    expect(buildKmsSigningMetric(42, false, "dev", 1_700_000_000_000)).toEqual({
      _aws: {
        Timestamp: 1_700_000_000_000,
        CloudWatchMetrics: [
          {
            Namespace: "ThinkWork/AgentCore",
            Dimensions: [["Stage"]],
            Metrics: [
              {
                Name: "TurnAssertionKmsSignLatency",
                Unit: "Milliseconds",
              },
              { Name: "TurnAssertionKmsSignFailures", Unit: "Count" },
            ],
          },
        ],
      },
      Stage: "dev",
      TurnAssertionKmsSignLatency: 42,
      TurnAssertionKmsSignFailures: 1,
    });
  });

  it("loads identity from the immutable turn instead of caller fields", async () => {
    const subject = deps();
    const handler = createTurnAssertionMintHandler(subject);

    const response = await handler({
      tenantId: "tenant-1",
      turnId: "turn-1",
      target: "harness",
      // Runtime input is untyped at the Lambda boundary. These hostile extras
      // must never replace the database-derived tuple.
      sessionGeneration: 999,
      subject: "mallory",
      agentId: "other-agent",
    } as never);

    expect(response.token).not.toContain("alice");
    expect(decodePayload(response.token)).toMatchObject({
      aud: "urn:thinkwork:harness:tenant-1",
      sub: "alice",
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      thread_id: "thread-1",
      turn_id: "turn-1",
      participant_id: "alice",
      session_generation: 3,
      purpose: "harness_invoke",
      scope: "harness:invoke",
    });
    expect(subject.loadTrustedTurn).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      turnId: "turn-1",
    });
  });

  it("binds Gateway assertions to the operation tuple", async () => {
    const handler = createTurnAssertionMintHandler(deps());

    const response = await handler({
      tenantId: "tenant-1",
      turnId: "turn-1",
      target: "gateway",
      operation: "owner_probe",
      toolUseId: "tool-use-1",
      inputHash: "sha256-input",
    });

    expect(decodePayload(response.token)).toMatchObject({
      aud: "urn:thinkwork:gateway:tenant-1",
      purpose: "gateway_operation",
      scope: "gateway:invoke",
      operation: "owner_probe",
      tool_use_id: "tool-use-1",
      input_hash: "sha256-input",
    });
  });

  it.each([
    ["missing turn", null],
    [
      "non-running turn",
      {
        tenantId: "tenant-1",
        agentId: "agent-1",
        threadId: "thread-1",
        turnId: "turn-1",
        triggeringMessageId: "message-1",
        participantId: "alice",
        sessionGeneration: 1,
        spaceId: null,
        runtimeType: "harness",
        status: "succeeded",
      },
    ],
    [
      "Pi turn",
      {
        tenantId: "tenant-1",
        agentId: "agent-1",
        threadId: "thread-1",
        turnId: "turn-1",
        triggeringMessageId: "message-1",
        participantId: "alice",
        sessionGeneration: 1,
        spaceId: null,
        runtimeType: "pi",
        status: "running",
      },
    ],
  ])("fails closed for %s", async (_label, trustedTurn) => {
    const handler = createTurnAssertionMintHandler(
      deps({ loadTrustedTurn: vi.fn(async () => trustedTurn) }),
    );

    await expect(
      handler({
        tenantId: "tenant-1",
        turnId: "turn-1",
        target: "harness",
      }),
    ).rejects.toThrow(/trusted running Harness turn/);
  });

  it("rejects a Gateway assertion without a complete operation binding", async () => {
    const handler = createTurnAssertionMintHandler(deps());

    await expect(
      handler({
        tenantId: "tenant-1",
        turnId: "turn-1",
        target: "gateway",
      }),
    ).rejects.toThrow(
      "gateway assertions require operation, toolUseId, and inputHash",
    );
  });
});
