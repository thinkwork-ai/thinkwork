/**
 * THINK-643 — the authorizer's consume routing and the cutover fallback.
 *
 * The safety property under test: `not_found` in DynamoDB is the ONLY outcome
 * that may reach Postgres. A ticket that exists and was already burned, or one
 * whose bound claims disagree, must be refused outright — falling back there
 * would re-admit a replay against a row the Postgres UPDATE would also have
 * refused, but only after a second round trip that could race.
 */

import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

import type { SubscriptionTicketClaims } from "../lib/subscription-ticket-signing.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const returning = vi.fn(async () => [{ id: "row-1" }]);
const updateWhere = vi.fn(() => ({ returning }));

vi.mock("../lib/db.js", () => ({
  db: {
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
  },
}));

const { defaultDependencies } =
  await import("./appsync-subscription-authorizer.js");
const { __resetAuthStateClientForTests } =
  await import("../lib/auth-state-store.js");

const ddb = mockClient(DynamoDBClient);

const NOW = 1_800_000_000;

const claims: SubscriptionTicketClaims = {
  version: 1,
  domain: "thinkwork.appsync.subscription.v1",
  algorithm: "Ed25519",
  issuer: "thinkwork-auth",
  stage: "dev",
  audience: "api-1",
  kind: "connect",
  nonce: "nonce-1",
  issuedAt: NOW,
  expiresAt: NOW + 60,
  cognitoIssuer: "https://cognito-idp.us-east-1.amazonaws.com/pool",
  cognitoSub: "cognito-sub",
  userId: "user-1",
  tenantId: "tenant-1",
  routeClientId: "route-1",
  appClientId: "app-client",
  keyId: "key-1",
};

function conditionFailure(
  item?: Record<string, { S?: string; N?: string }>,
): ConditionalCheckFailedException {
  const error = new ConditionalCheckFailedException({
    message: "The conditional request failed",
    $metadata: {},
  });
  if (item) (error as { Item?: unknown }).Item = item;
  return error;
}

beforeEach(() => {
  ddb.reset();
  __resetAuthStateClientForTests();
  returning.mockClear();
  returning.mockResolvedValue([{ id: "row-1" }]);
  updateWhere.mockClear();
  process.env.AUTH_STATE_TABLE = "thinkwork-test-auth-state";
});

afterEach(() => {
  delete process.env.AUTH_STATE_STORE;
  delete process.env.AUTH_STATE_TABLE;
});

describe("postgres path (default) is unchanged", () => {
  it("consumes via the Aurora conditional UPDATE and never touches DynamoDB", async () => {
    await expect(defaultDependencies.consume(claims)).resolves.toBe(true);
    expect(returning).toHaveBeenCalledTimes(1);
    expect(ddb.calls()).toHaveLength(0);
  });

  it("refuses when the UPDATE matched no row (replay or expiry)", async () => {
    returning.mockResolvedValueOnce([] as never);

    await expect(defaultDependencies.consume(claims)).resolves.toBe(false);
  });
});

describe("dynamo path", () => {
  beforeEach(() => {
    process.env.AUTH_STATE_STORE = "dynamo";
  });

  it("authorizes on the first consume without reading Postgres", async () => {
    ddb.on(UpdateItemCommand).resolves({});

    await expect(defaultDependencies.consume(claims)).resolves.toBe(true);
    expect(returning).not.toHaveBeenCalled();
  });

  it("refuses a replay of a consumed item and does NOT fall back", async () => {
    ddb.on(UpdateItemCommand).rejects(
      conditionFailure({
        pk: { S: "ticket#tenant-1" },
        consumed_at: { N: String(NOW) },
      }),
    );

    await expect(defaultDependencies.consume(claims)).resolves.toBe(false);
    expect(returning).not.toHaveBeenCalled();
  });

  it("refuses a claim mismatch and does NOT fall back", async () => {
    ddb
      .on(UpdateItemCommand)
      .rejects(conditionFailure({ pk: { S: "ticket#tenant-1" } }));

    await expect(defaultDependencies.consume(claims)).resolves.toBe(false);
    expect(returning).not.toHaveBeenCalled();
  });

  it("falls back to Postgres for a ticket minted just before the cutover", async () => {
    ddb.on(UpdateItemCommand).rejects(conditionFailure());

    await expect(defaultDependencies.consume(claims)).resolves.toBe(true);
    expect(returning).toHaveBeenCalledTimes(1);
  });

  it("still refuses when neither store knows the nonce", async () => {
    ddb.on(UpdateItemCommand).rejects(conditionFailure());
    returning.mockResolvedValueOnce([] as never);

    await expect(defaultDependencies.consume(claims)).resolves.toBe(false);
  });
});
