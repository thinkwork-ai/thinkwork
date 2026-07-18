import { generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  TurnAssertionError,
  buildTurnAssertionClaims,
  publicKeyDerToJwk,
  signTurnAssertion,
} from "./turn-assertion.js";

const trustedTurn = {
  issuer: "https://issuer.example.test/agentcore",
  audience: "urn:thinkwork:harness:tenant-1",
  subject: "user-alice",
  tenantId: "tenant-1",
  spaceId: "space-1",
  agentId: "agent-1",
  threadId: "thread-1",
  turnId: "turn-1",
  participantId: "user-alice",
  sessionGeneration: 2,
  purpose: "harness_invoke" as const,
  scopes: ["harness:invoke"],
  nowSeconds: 1_700_000_000,
  ttlSeconds: 300,
  jti: "assertion-jti-1",
};

describe("turn assertions", () => {
  it("builds a short-lived purpose-bound claim set from trusted turn fields", () => {
    expect(buildTurnAssertionClaims(trustedTurn)).toEqual({
      iss: trustedTurn.issuer,
      aud: trustedTurn.audience,
      sub: trustedTurn.subject,
      jti: trustedTurn.jti,
      iat: trustedTurn.nowSeconds,
      exp: trustedTurn.nowSeconds + 300,
      tenant_id: trustedTurn.tenantId,
      space_id: trustedTurn.spaceId,
      agent_id: trustedTurn.agentId,
      thread_id: trustedTurn.threadId,
      turn_id: trustedTurn.turnId,
      participant_id: trustedTurn.participantId,
      session_generation: trustedTurn.sessionGeneration,
      purpose: "harness_invoke",
      scope: "harness:invoke",
    });
  });

  it("rejects assertions that exceed the five-minute carrier ceiling", () => {
    expect(() =>
      buildTurnAssertionClaims({ ...trustedTurn, ttlSeconds: 301 }),
    ).toThrowError(
      new TurnAssertionError("ttlSeconds must be an integer between 1 and 300"),
    );
  });

  it("requires operation binding for Gateway assertions", () => {
    expect(() =>
      buildTurnAssertionClaims({
        ...trustedTurn,
        audience: "urn:thinkwork:gateway:tenant-1",
        purpose: "gateway_operation",
        scopes: ["gateway:invoke"],
      }),
    ).toThrowError(
      new TurnAssertionError(
        "gateway_operation assertions require operation, toolUseId, and inputHash",
      ),
    );

    expect(
      buildTurnAssertionClaims({
        ...trustedTurn,
        audience: "urn:thinkwork:gateway:tenant-1",
        purpose: "gateway_operation",
        scopes: ["gateway:invoke"],
        operation: "owner_probe",
        toolUseId: "tool-use-1",
        inputHash: "sha256-input",
      }),
    ).toMatchObject({
      purpose: "gateway_operation",
      operation: "owner_probe",
      tool_use_id: "tool-use-1",
      input_hash: "sha256-input",
    });
  });

  it("emits an RS256 JWT whose signature verifies against the published key", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const signer = vi.fn(async (message: Uint8Array) =>
      sign("RSA-SHA256", Buffer.from(message), privateKey),
    );

    const token = await signTurnAssertion(trustedTurn, {
      keyId: "kms-key-id",
      kid: "kid-2026-07",
      sign: signer,
    });
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");

    expect(
      JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")),
    ).toEqual({ alg: "RS256", kid: "kid-2026-07", typ: "JWT" });
    expect(
      JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")),
    ).toMatchObject({ sub: "user-alice", aud: trustedTurn.audience });
    expect(signer).toHaveBeenCalledTimes(1);
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        publicKey,
        Buffer.from(encodedSignature, "base64url"),
      ),
    ).toBe(true);
  });

  it("exports only the public RSA parameters needed by JWKS", () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const der = publicKey.export({ type: "spki", format: "der" });

    expect(publicKeyDerToJwk(der, "kid-2026-07")).toMatchObject({
      alg: "RS256",
      kid: "kid-2026-07",
      kty: "RSA",
      use: "sig",
    });
  });
});
