import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SUBSCRIPTION_TICKET_ALGORITHM,
  SUBSCRIPTION_TICKET_DOMAIN,
  SUBSCRIPTION_TICKET_ISSUER,
  createSubscriptionTicketSigner,
  subscriptionOperationHash,
  subscriptionTicketNonceDigest,
  verifySubscriptionTicket,
} from "./subscription-ticket-signing.js";

const pair = generateKeyPairSync("ed25519");
const otherPair = generateKeyPairSync("ed25519");
const signer = createSubscriptionTicketSigner("current", pair.privateKey);
const now = 1_800_000_000;

function ticket(overrides: Record<string, unknown> = {}) {
  return signer.sign({
    version: 1,
    domain: SUBSCRIPTION_TICKET_DOMAIN,
    algorithm: SUBSCRIPTION_TICKET_ALGORITHM,
    issuer: SUBSCRIPTION_TICKET_ISSUER,
    stage: "dev",
    audience: "appsync-api-1",
    kind: "registration",
    nonce: "nonce-1",
    issuedAt: now,
    expiresAt: now + 60,
    cognitoIssuer: "https://cognito-idp.us-east-1.amazonaws.com/pool",
    cognitoSub: "cognito-sub",
    userId: "user-1",
    tenantId: "tenant-1",
    routeClientId: "route-1",
    appClientId: "client-1",
    operationName: "OnNewMessage",
    operationHash: "hash-1",
    ...overrides,
  } as never);
}

function verify(token: string, overrides: Record<string, unknown> = {}) {
  return verifySubscriptionTicket(token, {
    stage: "dev",
    audience: "appsync-api-1",
    now,
    keys: [{ keyId: "current", publicKey: pair.publicKey }],
    ...overrides,
  } as never);
}

describe("subscription ticket signing", () => {
  it("round trips an Ed25519 registration ticket", () => {
    expect(verify(ticket()).operationName).toBe("OnNewMessage");
  });

  it.each([
    ["wrong stage", { stage: "prod" }, "stage_invalid"],
    ["wrong audience", { audience: "other-api" }, "audience_invalid"],
    ["expired", { now: now + 61 }, "expired"],
  ])("rejects %s", (_name, overrides, code) => {
    expect(() => verify(ticket(), overrides)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it("rejects a signature from another key", () => {
    expect(() =>
      verify(ticket(), {
        keys: [{ keyId: "current", publicKey: otherPair.publicKey }],
      }),
    ).toThrowError(expect.objectContaining({ code: "signature_invalid" }));
  });

  it("rejects an unknown, revoked, or expired overlap key", () => {
    expect(() => verify(ticket(), { keys: [] })).toThrowError(
      expect.objectContaining({ code: "key_unknown" }),
    );
    expect(() =>
      verify(ticket(), {
        keys: [{ keyId: "current", publicKey: pair.publicKey, revoked: true }],
      }),
    ).toThrowError(expect.objectContaining({ code: "key_revoked" }));
    expect(() =>
      verify(ticket(), {
        keys: [
          { keyId: "current", publicKey: pair.publicKey, verifyUntil: now - 1 },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "key_overlap_expired" }));
  });

  it("domain-separates ticket claims and fixes the algorithm", () => {
    expect(() => ticket({ domain: "capability-envelope" })).toThrowError(
      expect.objectContaining({ code: "claims_invalid" }),
    );
    expect(() => ticket({ algorithm: "HS256" })).toThrowError(
      expect.objectContaining({ code: "claims_invalid" }),
    );
  });

  it("requires operation binding only for registration tickets", () => {
    expect(() => ticket({ operationName: undefined })).toThrowError(
      expect.objectContaining({ code: "claims_invalid" }),
    );
    expect(() =>
      ticket({
        kind: "connect",
        operationName: undefined,
        operationHash: undefined,
      }),
    ).not.toThrow();
  });

  it("canonicalizes variables for a stable operation hash", () => {
    const first = subscriptionOperationHash({
      operationName: "OnNewMessage",
      query:
        "subscription OnNewMessage { onNewMessage(threadId: 1) { messageId } }",
      variables: { b: 2, a: { d: 4, c: 3 } },
    });
    const second = subscriptionOperationHash({
      operationName: "OnNewMessage",
      query:
        "subscription  OnNewMessage { onNewMessage(threadId: 1) { messageId } }",
      variables: { a: { c: 3, d: 4 }, b: 2 },
    });
    expect(first).toBe(second);
  });

  it("persists a one-way nonce digest", () => {
    expect(subscriptionTicketNonceDigest("secret-nonce")).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(subscriptionTicketNonceDigest("secret-nonce")).not.toContain(
      "secret-nonce",
    );
  });
});
