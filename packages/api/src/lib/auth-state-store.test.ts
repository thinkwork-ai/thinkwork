/**
 * THINK-643 — DynamoDB auth-state store semantics.
 *
 * The conditional-write behavior is the whole point of the migration: it is
 * what replaces the Postgres `status = 'issued'` predicate that made a ticket
 * single-use. These tests pin it at the command level (mocked DynamoDB client),
 * including the three-way consume outcome that lets the authorizer tell a
 * replay apart from a nonce it has simply never seen.
 */

import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  TICKET_TTL_GRACE_SECONDS,
  __resetAuthStateClientForTests,
  authStateStoreMode,
  bumpCounter,
  consumeOAuthState,
  consumeTicket,
  getTicket,
  putOAuthState,
  putTicket,
  type AuthStateTicket,
} from "./auth-state-store.js";

const ddb = mockClient(DynamoDBClient);

const NOW = 1_800_000_000;

const ticket: AuthStateTicket = {
  nonceDigest: "digest-1",
  kind: "connect",
  stage: "dev",
  audience: "api-1",
  keyId: "key-1",
  cognitoIssuer: "https://cognito-idp.us-east-1.amazonaws.com/pool",
  cognitoSub: "cognito-sub",
  userId: "user-1",
  tenantId: "tenant-1",
  routeClientId: "route-1",
  issuedAt: NOW,
  expiresAt: NOW + 60,
};

/** Builds the SDK's condition-failure error with the pre-write item attached. */
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
  process.env.AUTH_STATE_TABLE = "thinkwork-test-auth-state";
});

afterEach(() => {
  delete process.env.AUTH_STATE_TABLE;
  delete process.env.AUTH_STATE_STORE;
});

describe("authStateStoreMode", () => {
  it("defaults to postgres so an unset stage never reaches an absent table", () => {
    expect(authStateStoreMode()).toBe("postgres");
  });

  it("only an exact dynamo value flips the store", () => {
    process.env.AUTH_STATE_STORE = "DynamoDB";
    expect(authStateStoreMode()).toBe("postgres");
    process.env.AUTH_STATE_STORE = " Dynamo ";
    expect(authStateStoreMode()).toBe("dynamo");
  });
});

describe("putTicket", () => {
  it("writes the ticket claims with a TTL past the ticket's own expiry", async () => {
    ddb.on(PutItemCommand).resolves({});

    await putTicket(ticket, NOW);

    const input = ddb.commandCalls(PutItemCommand)[0].args[0].input;
    expect(input.TableName).toBe("thinkwork-test-auth-state");
    expect(input.Item?.pk).toEqual({ S: "ticket#tenant-1" });
    expect(input.Item?.sk).toEqual({ S: "digest-1" });
    expect(input.Item?.status).toEqual({ S: "issued" });
    expect(input.Item?.cognito_sub).toEqual({ S: "cognito-sub" });
    expect(input.Item?.ticket_expires_at).toEqual({ N: String(NOW + 60) });
    // TTL sweeps an hour AFTER the ticket dies, so a replay still finds the
    // tombstone rather than a clean miss that would fall back to Postgres.
    expect(input.Item?.expires_at).toEqual({
      N: String(NOW + 60 + TICKET_TTL_GRACE_SECONDS),
    });
  });

  it("omits absent registration claims instead of writing empty strings", async () => {
    ddb.on(PutItemCommand).resolves({});

    await putTicket(ticket, NOW);

    const item = ddb.commandCalls(PutItemCommand)[0].args[0].input.Item!;
    expect(item.operation_name).toBeUndefined();
    expect(item.resource_id).toBeUndefined();
  });

  it("carries registration claims when present", async () => {
    ddb.on(PutItemCommand).resolves({});

    await putTicket(
      {
        ...ticket,
        kind: "registration",
        operationName: "OnNewMessage",
        operationHash: "hash-1",
        resourceKind: "thread",
        resourceId: "thread-1",
      },
      NOW,
    );

    const item = ddb.commandCalls(PutItemCommand)[0].args[0].input.Item!;
    expect(item.operation_name).toEqual({ S: "OnNewMessage" });
    expect(item.resource_id).toEqual({ S: "thread-1" });
  });
});

describe("consumeTicket", () => {
  const claims = {
    nonceDigest: ticket.nonceDigest,
    kind: ticket.kind,
    stage: ticket.stage,
    audience: ticket.audience,
    keyId: ticket.keyId,
    cognitoIssuer: ticket.cognitoIssuer,
    cognitoSub: ticket.cognitoSub,
    userId: ticket.userId,
    tenantId: ticket.tenantId,
    routeClientId: ticket.routeClientId,
  };

  it("first consume wins and burns the nonce conditionally", async () => {
    ddb.on(UpdateItemCommand).resolves({});

    await expect(consumeTicket(claims, NOW)).resolves.toEqual({
      outcome: "consumed",
    });

    const input = ddb.commandCalls(UpdateItemCommand)[0].args[0].input;
    expect(input.Key).toEqual({
      pk: { S: "ticket#tenant-1" },
      sk: { S: "digest-1" },
    });
    expect(input.ConditionExpression).toContain(
      "attribute_not_exists(#consumed_at)",
    );
    expect(input.ConditionExpression).toContain("ticket_expires_at > :now");
    // Every claim the Postgres WHERE clause bound is still bound here.
    for (const column of [
      "kind",
      "stage",
      "appsync_api_id",
      "key_id",
      "cognito_issuer",
      "cognito_sub",
      "user_id",
      "tenant_id",
      "auth_route_client_id",
    ]) {
      expect(Object.values(input.ExpressionAttributeNames ?? {})).toContain(
        column,
      );
    }
    expect(input.ReturnValuesOnConditionCheckFailure).toBe("ALL_OLD");
  });

  it("refuses a second consume of the same nonce as already_consumed", async () => {
    ddb.on(UpdateItemCommand).rejects(
      conditionFailure({
        pk: { S: "ticket#tenant-1" },
        consumed_at: { N: String(NOW) },
      }),
    );

    await expect(consumeTicket(claims, NOW)).resolves.toEqual({
      outcome: "already_consumed",
    });
  });

  it("reports an unknown nonce as not_found so callers may fall back", async () => {
    ddb.on(UpdateItemCommand).rejects(conditionFailure());

    await expect(consumeTicket(claims, NOW)).resolves.toEqual({
      outcome: "not_found",
    });
  });

  it("reports a claim/expiry disagreement as mismatch, never not_found", async () => {
    ddb
      .on(UpdateItemCommand)
      .rejects(conditionFailure({ pk: { S: "ticket#tenant-1" } }));

    await expect(consumeTicket(claims, NOW)).resolves.toEqual({
      outcome: "mismatch",
    });
  });

  it("propagates non-conditional errors instead of swallowing them", async () => {
    ddb.on(UpdateItemCommand).rejects(new Error("throttled"));

    await expect(consumeTicket(claims, NOW)).rejects.toThrow("throttled");
  });
});

describe("getTicket", () => {
  it("reads an item back into ticket claims", async () => {
    ddb.on(GetItemCommand).resolves({
      Item: {
        pk: { S: "ticket#tenant-1" },
        sk: { S: "digest-1" },
        kind: { S: "connect" },
        status: { S: "consumed" },
        stage: { S: "dev" },
        appsync_api_id: { S: "api-1" },
        key_id: { S: "key-1" },
        cognito_issuer: { S: "issuer" },
        cognito_sub: { S: "sub" },
        user_id: { S: "user-1" },
        tenant_id: { S: "tenant-1" },
        auth_route_client_id: { S: "route-1" },
        issued_at: { N: String(NOW) },
        ticket_expires_at: { N: String(NOW + 60) },
        consumed_at: { N: String(NOW + 5) },
      },
    });

    await expect(
      getTicket({ tenantId: "tenant-1", nonceDigest: "digest-1" }),
    ).resolves.toMatchObject({
      status: "consumed",
      consumedAt: NOW + 5,
      expiresAt: NOW + 60,
      userId: "user-1",
    });
  });

  it("returns null when there is no item", async () => {
    ddb.on(GetItemCommand).resolves({});

    await expect(
      getTicket({ tenantId: "tenant-1", nonceDigest: "nope" }),
    ).resolves.toBeNull();
  });
});

describe("bumpCounter", () => {
  it("increments atomically inside an aligned window and returns the new count", async () => {
    ddb.on(UpdateItemCommand).resolves({ Attributes: { count: { N: "3" } } });

    await expect(bumpCounter("connect#issuer#sub", 60, NOW + 17)).resolves.toBe(
      3,
    );

    const input = ddb.commandCalls(UpdateItemCommand)[0].args[0].input;
    expect(input.Key).toEqual({
      pk: { S: "counter#connect#issuer#sub" },
      // NOW is a multiple of 60, so +17s still lands in the NOW window.
      sk: { S: `w#${NOW}` },
    });
    expect(input.UpdateExpression).toBe(
      "SET expires_at = :ttl ADD #count :one",
    );
    expect(input.ExpressionAttributeValues?.[":one"]).toEqual({ N: "1" });
    // Two window widths of TTL — the item outlives its own window so a late
    // request in the same window still sees the accumulated count.
    expect(input.ExpressionAttributeValues?.[":ttl"]).toEqual({
      N: String(NOW + 120),
    });
  });

  it("starts a fresh item in the next window", async () => {
    ddb.on(UpdateItemCommand).resolves({ Attributes: { count: { N: "1" } } });

    await expect(bumpCounter("k", 60, NOW + 61)).resolves.toBe(1);
    expect(
      ddb.commandCalls(UpdateItemCommand)[0].args[0].input.Key?.sk,
    ).toEqual({ S: `w#${NOW + 60}` });
  });
});

describe("OAuth transaction state", () => {
  it("writes state with a TTL and refuses to overwrite an existing id", async () => {
    ddb.on(PutItemCommand).resolves({});

    await putOAuthState({
      stateId: "state-1",
      payload: { connectionId: "conn-1" },
      expiresAt: NOW + 600,
    });

    const input = ddb.commandCalls(PutItemCommand)[0].args[0].input;
    expect(input.Item?.pk).toEqual({ S: "oauth#state-1" });
    expect(input.Item?.sk).toEqual({ S: "state" });
    expect(input.Item?.expires_at).toEqual({ N: String(NOW + 600) });
    expect(input.ConditionExpression).toBe("attribute_not_exists(pk)");
  });

  it("consumes state exactly once via a conditional delete", async () => {
    ddb.on(DeleteItemCommand).resolves({
      Attributes: { payload: { M: { connectionId: { S: "conn-1" } } } },
    });

    await expect(consumeOAuthState("state-1", NOW)).resolves.toEqual({
      connectionId: "conn-1",
    });
    const input = ddb.commandCalls(DeleteItemCommand)[0].args[0].input;
    expect(input.ConditionExpression).toBe(
      "attribute_exists(pk) AND expires_at > :now",
    );
    expect(input.ReturnValues).toBe("ALL_OLD");
  });

  it("returns null when the state was already consumed or expired", async () => {
    ddb.on(DeleteItemCommand).rejects(conditionFailure());

    await expect(consumeOAuthState("state-1", NOW)).resolves.toBeNull();
  });
});
