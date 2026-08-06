/**
 * THINK-643 — the mint handler's store routing.
 *
 * Two obligations, and they are asymmetric:
 *  - postgres (default): the Aurora insert and the COUNT must be byte-identical
 *    to what shipped, and DynamoDB must not be touched at all.
 *  - dynamo: the same claim set lands as an item, and the connect rate limit
 *    becomes an atomic TTL-windowed counter with the same allow/deny boundary.
 */

import {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

import type { SubscriptionTicketClaims } from "../lib/subscription-ticket-signing.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const insertValues = vi.fn(async () => undefined);
const selectWhere = vi.fn(async () => [{ count: 4 }]);

vi.mock("../lib/db.js", () => ({
  db: {
    insert: vi.fn(() => ({ values: insertValues })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: selectWhere })),
    })),
  },
}));

const {
  countRecentConnectTicketsDynamo,
  countRecentConnectTicketsPostgres,
  defaultDependencies,
  persistTicketDynamo,
  persistTicketPostgres,
} = await import("./auth-subscription-ticket.js");
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

beforeEach(() => {
  ddb.reset();
  __resetAuthStateClientForTests();
  insertValues.mockClear();
  selectWhere.mockClear();
  process.env.AUTH_STATE_TABLE = "thinkwork-test-auth-state";
});

afterEach(() => {
  delete process.env.AUTH_STATE_STORE;
  delete process.env.AUTH_STATE_TABLE;
});

describe("postgres path (default) is unchanged", () => {
  it("routes persist to the Aurora insert and never calls DynamoDB", async () => {
    await defaultDependencies.persist({ nonceDigest: "digest-1", claims });

    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(ddb.calls()).toHaveLength(0);
  });

  it("inserts exactly the columns the pre-THINK-643 handler inserted", async () => {
    await persistTicketPostgres({ nonceDigest: "digest-1", claims });

    expect(insertValues).toHaveBeenCalledWith({
      nonce_digest: "digest-1",
      kind: "connect",
      status: "issued",
      stage: "dev",
      appsync_api_id: "api-1",
      key_id: "key-1",
      cognito_issuer: claims.cognitoIssuer,
      cognito_sub: "cognito-sub",
      user_id: "user-1",
      tenant_id: "tenant-1",
      auth_route_client_id: "route-1",
      operation_name: null,
      operation_hash: null,
      resource_kind: null,
      resource_id: null,
      expires_at: new Date((NOW + 60) * 1000),
    });
  });

  it("routes the connect rate limit to the Aurora COUNT", async () => {
    const since = new Date(NOW * 1000);

    await expect(
      defaultDependencies.countRecentConnectTickets({
        cognitoIssuer: claims.cognitoIssuer,
        cognitoSub: "cognito-sub",
        since,
      }),
    ).resolves.toBe(4);
    expect(selectWhere).toHaveBeenCalledTimes(1);
    expect(ddb.calls()).toHaveLength(0);
  });

  it("counts zero when the COUNT returns no row", async () => {
    selectWhere.mockResolvedValueOnce([] as never);

    await expect(
      countRecentConnectTicketsPostgres({
        cognitoIssuer: claims.cognitoIssuer,
        cognitoSub: "cognito-sub",
        since: new Date(NOW * 1000),
      }),
    ).resolves.toBe(0);
  });
});

describe("dynamo path", () => {
  beforeEach(() => {
    process.env.AUTH_STATE_STORE = "dynamo";
  });

  it("routes persist to a DynamoDB item carrying the same claims", async () => {
    ddb.on(PutItemCommand).resolves({});

    await defaultDependencies.persist({ nonceDigest: "digest-1", claims });

    expect(insertValues).not.toHaveBeenCalled();
    const item = ddb.commandCalls(PutItemCommand)[0].args[0].input.Item!;
    expect(item.pk).toEqual({ S: "ticket#tenant-1" });
    expect(item.sk).toEqual({ S: "digest-1" });
    expect(item.key_id).toEqual({ S: "key-1" });
    expect(item.auth_route_client_id).toEqual({ S: "route-1" });
    expect(item.ticket_expires_at).toEqual({ N: String(NOW + 60) });
  });

  it("carries registration operation binding onto the item", async () => {
    ddb.on(PutItemCommand).resolves({});

    await persistTicketDynamo({
      nonceDigest: "digest-2",
      claims: {
        ...claims,
        kind: "registration",
        operationName: "OnNewMessage",
        operationHash: "hash-1",
        resourceKind: "thread",
        resourceId: "thread-1",
      },
    });

    const item = ddb.commandCalls(PutItemCommand)[0].args[0].input.Item!;
    expect(item.operation_hash).toEqual({ S: "hash-1" });
    expect(item.resource_kind).toEqual({ S: "thread" });
  });

  it("routes the connect rate limit to an atomic counter, not the COUNT", async () => {
    ddb.on(UpdateItemCommand).resolves({ Attributes: { count: { N: "5" } } });

    await expect(
      defaultDependencies.countRecentConnectTickets({
        cognitoIssuer: claims.cognitoIssuer,
        cognitoSub: "cognito-sub",
        since: new Date(NOW * 1000),
      }),
      // bumpCounter returns the post-increment value; the handler compares
      // PRIOR attempts against the max, so 5 bumped ⇒ 4 prior.
    ).resolves.toBe(4);
    expect(selectWhere).not.toHaveBeenCalled();
    expect(
      ddb.commandCalls(UpdateItemCommand)[0].args[0].input.Key?.pk,
    ).toEqual({ S: `counter#connect#${claims.cognitoIssuer}#cognito-sub` });
  });

  it("reports the first attempt in a window as zero prior attempts", async () => {
    ddb.on(UpdateItemCommand).resolves({ Attributes: { count: { N: "1" } } });

    await expect(
      countRecentConnectTicketsDynamo({
        cognitoIssuer: claims.cognitoIssuer,
        cognitoSub: "cognito-sub",
      }),
    ).resolves.toBe(0);
  });
});
