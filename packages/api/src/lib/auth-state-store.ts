/**
 * THINK-643/644 — DynamoDB short-lived state store.
 *
 * Short-lived auth-flow state (60s AppSync subscription tickets, per-principal
 * connect counters, single-use OAuth transaction state) is pure churn on the
 * primary Aurora cluster: one customer stage accumulated 551k
 * `auth_subscription_tickets` rows for data whose useful life is a minute.
 * DynamoDB is the right shape — native TTL sweeps the garbage, conditional
 * writes give the same single-use guarantee the `status = 'issued'` predicate
 * gave, and the table is reachable from the non-VPC auth Lambdas.
 *
 * THINK-644 extends the same table past auth: any TTL-shaped receipt — a record
 * whose only job is "I already handled this, don't handle it twice" — belongs
 * here rather than in Aurora, where it is unbounded append-only garbage. One
 * table, one flag: `AUTH_STATE_STORE` flips tickets, counters, and receipts
 * together, because they share a table and a blast radius. There is no case for
 * running half of a stage's scratch state on each store.
 *
 * Everything here is flag-gated by `AUTH_STATE_STORE` (see
 * {@link authStateStoreMode}). While the flag reads "postgres" none of these
 * helpers are called and the table need not exist.
 *
 * Single-table layout (`thinkwork-<stage>-auth-state`, pk/sk):
 *
 *   kind      pk                              sk                attrs
 *   --------- ------------------------------- ----------------- --------------
 *   ticket    ticket#<tenantId>               <nonceDigest>     ticket claims
 *   counter   counter#<key>                   w#<windowStart>   count
 *   oauth     oauth#<stateId>                 state             payload
 *   receipt   receipt#<kind>#<keyDigest>      r                 receipt_key,
 *                                                               value
 *
 * `expires_at` (N, epoch seconds) is the table's TTL attribute on every item.
 * For tickets it is deliberately NOT the ticket's own expiry — DynamoDB TTL
 * deletion is best-effort and can lag by 48h, so a replay attempt must still
 * find the consumed tombstone. The item therefore carries the semantic expiry
 * as `ticket_expires_at` and sets `expires_at` an hour later as a grace window.
 */

import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { getConfig } from "@thinkwork/runtime-config";
import { createHash } from "node:crypto";

export type AuthStateStoreMode = "postgres" | "dynamo";

/** Grace period between a ticket's own expiry and its DynamoDB TTL. */
export const TICKET_TTL_GRACE_SECONDS = 60 * 60;

/**
 * Which backing store the auth handlers use. Anything other than an exact
 * "dynamo" leaves the Postgres path in charge — an unset, empty, or typo'd
 * value must never silently take realtime auth onto an unprovisioned table.
 */
export function authStateStoreMode(): AuthStateStoreMode {
  return getConfig("AUTH_STATE_STORE", "postgres").trim().toLowerCase() ===
    "dynamo"
    ? "dynamo"
    : "postgres";
}

export function authStateTableName(): string {
  const name = getConfig("AUTH_STATE_TABLE", "").trim();
  if (!name) {
    throw new Error(
      "AUTH_STATE_TABLE is not configured but AUTH_STATE_STORE=dynamo",
    );
  }
  return name;
}

let client: DynamoDBClient | null = null;

export function authStateClient(): DynamoDBClient {
  client ??= new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
  return client;
}

/** Test seam — drops the memoized client so a fresh mock is picked up. */
export function __resetAuthStateClientForTests(): void {
  client = null;
}

const S = (value: string): AttributeValue => ({ S: value });
const N = (value: number): AttributeValue => ({ N: String(value) });

/** Drops undefined/null entries so absent claims stay absent attributes. */
function compactItem(
  item: Record<string, AttributeValue | undefined>,
): Record<string, AttributeValue> {
  return Object.fromEntries(
    Object.entries(item).filter(([, v]) => v !== undefined),
  ) as Record<string, AttributeValue>;
}

// ---------------------------------------------------------------------------
// Subscription tickets
// ---------------------------------------------------------------------------

/** The claim set a ticket item carries — the columns the Aurora row carried. */
export interface AuthStateTicket {
  nonceDigest: string;
  kind: "connect" | "registration";
  stage: string;
  audience: string;
  keyId: string;
  cognitoIssuer: string;
  cognitoSub: string;
  userId: string;
  tenantId: string;
  routeClientId: string;
  operationName?: string | undefined;
  operationHash?: string | undefined;
  resourceKind?: string | undefined;
  resourceId?: string | undefined;
  issuedAt: number;
  expiresAt: number;
}

export interface StoredAuthStateTicket extends AuthStateTicket {
  status: "issued" | "consumed";
  consumedAt: number | null;
}

export type ConsumeTicketResult =
  /** This call burned the nonce; the caller may authorize. */
  | { outcome: "consumed" }
  /** A previous call already burned it — a replay. Refuse. */
  | { outcome: "already_consumed" }
  /** No item under this pk/sk. Callers may fall back to Postgres. */
  | { outcome: "not_found" }
  /** Item exists but bound claims disagree, or it expired. Refuse. */
  | { outcome: "mismatch" };

const ticketPk = (tenantId: string) => `ticket#${tenantId}`;

export async function putTicket(
  ticket: AuthStateTicket,
  now: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  await authStateClient().send(
    new PutItemCommand({
      TableName: authStateTableName(),
      Item: compactItem({
        pk: S(ticketPk(ticket.tenantId)),
        sk: S(ticket.nonceDigest),
        kind: S(ticket.kind),
        status: S("issued"),
        stage: S(ticket.stage),
        appsync_api_id: S(ticket.audience),
        key_id: S(ticket.keyId),
        cognito_issuer: S(ticket.cognitoIssuer),
        cognito_sub: S(ticket.cognitoSub),
        user_id: S(ticket.userId),
        tenant_id: S(ticket.tenantId),
        auth_route_client_id: S(ticket.routeClientId),
        operation_name: ticket.operationName
          ? S(ticket.operationName)
          : undefined,
        operation_hash: ticket.operationHash
          ? S(ticket.operationHash)
          : undefined,
        resource_kind: ticket.resourceKind ? S(ticket.resourceKind) : undefined,
        resource_id: ticket.resourceId ? S(ticket.resourceId) : undefined,
        created_at: N(now),
        issued_at: N(ticket.issuedAt),
        ticket_expires_at: N(ticket.expiresAt),
        expires_at: N(ticket.expiresAt + TICKET_TTL_GRACE_SECONDS),
      }),
    }),
  );
}

export async function getTicket(input: {
  tenantId: string;
  nonceDigest: string;
}): Promise<StoredAuthStateTicket | null> {
  const result = await authStateClient().send(
    new GetItemCommand({
      TableName: authStateTableName(),
      Key: { pk: S(ticketPk(input.tenantId)), sk: S(input.nonceDigest) },
      ConsistentRead: true,
    }),
  );
  return result.Item ? readTicketItem(result.Item) : null;
}

/**
 * Atomically burn a ticket nonce. Mirrors the Postgres UPDATE's WHERE clause:
 * every bound claim must match, the ticket must not have expired, and it must
 * not already be consumed. `ALL_OLD` on the condition failure is what lets the
 * caller distinguish a replay (refuse) from an unknown nonce (which, right
 * after a store cutover, may still be a live row in Postgres).
 */
export async function consumeTicket(
  ticket: Omit<AuthStateTicket, "issuedAt" | "expiresAt">,
  now: number = Math.floor(Date.now() / 1000),
): Promise<ConsumeTicketResult> {
  const bound: Array<[string, string]> = [
    ["kind", ticket.kind],
    ["stage", ticket.stage],
    ["appsync_api_id", ticket.audience],
    ["key_id", ticket.keyId],
    ["cognito_issuer", ticket.cognitoIssuer],
    ["cognito_sub", ticket.cognitoSub],
    ["user_id", ticket.userId],
    ["tenant_id", ticket.tenantId],
    ["auth_route_client_id", ticket.routeClientId],
  ];
  const names: Record<string, string> = { "#consumed_at": "consumed_at" };
  const values: Record<string, AttributeValue> = { ":now": N(now) };
  const conditions = [
    "attribute_exists(pk)",
    "attribute_not_exists(#consumed_at)",
    "ticket_expires_at > :now",
  ];
  bound.forEach(([column, value], index) => {
    names[`#b${index}`] = column;
    values[`:b${index}`] = S(value);
    conditions.push(`#b${index} = :b${index}`);
  });
  values[":consumed"] = S("consumed");
  values[":consumed_at"] = N(now);

  try {
    await authStateClient().send(
      new UpdateItemCommand({
        TableName: authStateTableName(),
        Key: { pk: S(ticketPk(ticket.tenantId)), sk: S(ticket.nonceDigest) },
        UpdateExpression:
          "SET #status = :consumed, #consumed_at = :consumed_at",
        ExpressionAttributeNames: { ...names, "#status": "status" },
        ExpressionAttributeValues: values,
        ConditionExpression: conditions.join(" AND "),
        ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      }),
    );
    return { outcome: "consumed" };
  } catch (cause) {
    if (!(cause instanceof ConditionalCheckFailedException)) throw cause;
    const item = cause.Item;
    if (!item || !item.pk) return { outcome: "not_found" };
    return item.consumed_at
      ? { outcome: "already_consumed" }
      : { outcome: "mismatch" };
  }
}

function str(item: Record<string, AttributeValue>, key: string): string {
  return item[key]?.S ?? "";
}

function optionalStr(
  item: Record<string, AttributeValue>,
  key: string,
): string | undefined {
  return item[key]?.S ?? undefined;
}

function num(item: Record<string, AttributeValue>, key: string): number {
  const raw = item[key]?.N;
  return raw === undefined ? 0 : Number(raw);
}

function readTicketItem(
  item: Record<string, AttributeValue>,
): StoredAuthStateTicket {
  return {
    nonceDigest: str(item, "sk"),
    kind: str(item, "kind") === "connect" ? "connect" : "registration",
    stage: str(item, "stage"),
    audience: str(item, "appsync_api_id"),
    keyId: str(item, "key_id"),
    cognitoIssuer: str(item, "cognito_issuer"),
    cognitoSub: str(item, "cognito_sub"),
    userId: str(item, "user_id"),
    tenantId: str(item, "tenant_id"),
    routeClientId: str(item, "auth_route_client_id"),
    operationName: optionalStr(item, "operation_name"),
    operationHash: optionalStr(item, "operation_hash"),
    resourceKind: optionalStr(item, "resource_kind"),
    resourceId: optionalStr(item, "resource_id"),
    issuedAt: num(item, "issued_at"),
    expiresAt: num(item, "ticket_expires_at"),
    status: str(item, "status") === "consumed" ? "consumed" : "issued",
    consumedAt: item.consumed_at?.N ? Number(item.consumed_at.N) : null,
  };
}

// ---------------------------------------------------------------------------
// TTL-windowed counters
// ---------------------------------------------------------------------------

/**
 * The shared TTL-counter primitive. Atomically increments a fixed-window
 * counter and returns the post-increment value. The window is derived from the
 * clock (`floor(now / windowSeconds)`), so each window is a distinct item that
 * TTL sweeps on its own — no cleanup job, and no read-modify-write race between
 * concurrent Lambda invocations.
 *
 * Nothing about this is auth-specific: `key` is an opaque caller-namespaced
 * string, so any "at most N of X per window" backstop can use it (the connect
 * rate limit in auth-subscription-ticket is simply its first consumer). Callers
 * must gate on {@link authStateStoreMode} — there is no Postgres fallback here.
 */
export async function ttlCounter(
  key: string,
  windowSeconds: number,
  now: number = Math.floor(Date.now() / 1000),
): Promise<number> {
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const result = await authStateClient().send(
    new UpdateItemCommand({
      TableName: authStateTableName(),
      Key: { pk: S(`counter#${key}`), sk: S(`w#${windowStart}`) },
      UpdateExpression: "SET expires_at = :ttl ADD #count :one",
      ExpressionAttributeNames: { "#count": "count" },
      ExpressionAttributeValues: {
        ":ttl": N(windowStart + windowSeconds * 2),
        ":one": N(1),
      },
      ReturnValues: "UPDATED_NEW",
    }),
  );
  return Number(result.Attributes?.count?.N ?? 0);
}

// ---------------------------------------------------------------------------
// Idempotency receipts (THINK-644)
// ---------------------------------------------------------------------------

/**
 * A receipt's pk always carries a digest of the key rather than the key itself.
 *
 * Receipt keys are caller-supplied — the webhook receipt key embeds an
 * `X-Idempotency-Key` request header, which API Gateway will carry up to its
 * ~10 KB header budget, five times DynamoDB's 2048-byte partition-key ceiling.
 * Hashing conditionally (raw when short, digest when long) would create two pk
 * encodings and, with them, a collision class between a short raw key and some
 * long key's digest. Hashing unconditionally costs nothing, has one shape, and
 * keeps the item debuggable by storing the raw key on `receipt_key`.
 */
export function receiptPk(kind: string, key: string): string {
  return `receipt#${kind}#${createHash("sha256").update(key).digest("hex")}`;
}

/** Every receipt is a single item; the sort key is a constant placeholder. */
const RECEIPT_SK = "r";

export type ClaimReceiptResult =
  /** This call wrote the receipt; the caller owns the work. */
  | { outcome: "claimed" }
  /** A live receipt already existed — a duplicate delivery. */
  | { outcome: "duplicate"; value: Record<string, string> | undefined };

function readReceiptValue(
  item: Record<string, AttributeValue> | undefined,
): Record<string, string> | undefined {
  const value = item?.value?.M;
  if (!value) return undefined;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, v.S ?? ""]),
  );
}

/**
 * Read a live receipt. Returns null when absent or logically expired.
 *
 * The explicit `expires_at` comparison is not belt-and-braces: DynamoDB's TTL
 * deletion is best-effort and can lag the stated expiry by up to 48h, so an
 * item's presence is not proof it is still in force. Time is the contract; the
 * sweeper is only the janitor.
 */
export async function getReceipt(
  kind: string,
  key: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<{ value: Record<string, string> | undefined } | null> {
  const result = await authStateClient().send(
    new GetItemCommand({
      TableName: authStateTableName(),
      Key: { pk: S(receiptPk(kind, key)), sk: S(RECEIPT_SK) },
      ConsistentRead: true,
    }),
  );
  const item = result.Item;
  if (!item) return null;
  if (Number(item.expires_at?.N ?? 0) <= now) return null;
  return { value: readReceiptValue(item) };
}

/**
 * Write a receipt if no live one exists, atomically.
 *
 * The condition admits a logically-expired-but-unswept item (see
 * {@link getReceipt}) so a key becomes reusable exactly at its stated TTL
 * rather than whenever DynamoDB gets around to the delete.
 *
 * On `duplicate` the pre-existing item's `value` comes back, so a caller that
 * stored a downstream identifier at claim time can hand the same identifier to
 * the duplicate caller.
 */
export async function claimReceipt(
  kind: string,
  key: string,
  ttlSeconds: number,
  value?: Record<string, string>,
  now: number = Math.floor(Date.now() / 1000),
): Promise<ClaimReceiptResult> {
  try {
    await authStateClient().send(
      new PutItemCommand({
        TableName: authStateTableName(),
        Item: compactItem({
          pk: S(receiptPk(kind, key)),
          sk: S(RECEIPT_SK),
          receipt_kind: S(kind),
          receipt_key: S(key),
          created_at: N(now),
          expires_at: N(now + ttlSeconds),
          value: value
            ? {
                M: Object.fromEntries(
                  Object.entries(value).map(([k, v]) => [k, S(v)]),
                ),
              }
            : undefined,
        }),
        ConditionExpression: "attribute_not_exists(pk) OR expires_at <= :now",
        ExpressionAttributeValues: { ":now": N(now) },
        ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      }),
    );
    return { outcome: "claimed" };
  } catch (cause) {
    if (!(cause instanceof ConditionalCheckFailedException)) throw cause;
    return { outcome: "duplicate", value: readReceiptValue(cause.Item) };
  }
}

// ---------------------------------------------------------------------------
// Single-use OAuth transaction state
// ---------------------------------------------------------------------------

export interface OAuthStateRecord {
  stateId: string;
  payload: Record<string, string>;
  expiresAt: number;
}

const oauthPk = (stateId: string) => `oauth#${stateId}`;

export async function putOAuthState(record: OAuthStateRecord): Promise<void> {
  await authStateClient().send(
    new PutItemCommand({
      TableName: authStateTableName(),
      Item: {
        pk: S(oauthPk(record.stateId)),
        sk: S("state"),
        payload: {
          M: Object.fromEntries(
            Object.entries(record.payload).map(([k, v]) => [k, S(v)]),
          ),
        },
        expires_at: N(record.expiresAt),
      },
      // A state id is minted from a CSPRNG; a collision means replay, not luck.
      ConditionExpression: "attribute_not_exists(pk)",
    }),
  );
}

/**
 * Single-use read: the conditional delete both fetches and burns the record,
 * so two concurrent callbacks carrying the same `state` cannot both proceed.
 * Returns null when absent, already consumed, or expired.
 */
export async function consumeOAuthState(
  stateId: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<Record<string, string> | null> {
  try {
    const result = await authStateClient().send(
      new DeleteItemCommand({
        TableName: authStateTableName(),
        Key: { pk: S(oauthPk(stateId)), sk: S("state") },
        ConditionExpression: "attribute_exists(pk) AND expires_at > :now",
        ExpressionAttributeValues: { ":now": N(now) },
        ReturnValues: "ALL_OLD",
      }),
    );
    const payload = result.Attributes?.payload?.M;
    if (!payload) return null;
    return Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [k, v.S ?? ""]),
    );
  } catch (cause) {
    if (cause instanceof ConditionalCheckFailedException) return null;
    throw cause;
  }
}
