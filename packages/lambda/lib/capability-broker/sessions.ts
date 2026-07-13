/**
 * Capability broker session store (THINK-280 U3).
 *
 * Durable, replay-safe proof-of-possession session state, persisted in a
 * single DynamoDB table. The broker is SESSIONED (unlike the stateless
 * analyst-query-broker): every call consumes a strict next sequence and a
 * unique nonce through DynamoDB conditional writes, so a replayed request
 * is rejected atomically BEFORE any policy, credential, or adapter work.
 *
 * This module is pure over an injected {@link DynamoPort} + table name. The
 * condition predicates live here as structured {@link DynamoCondition}
 * values — the real adapter (dynamo-port.ts) translates them to DynamoDB
 * ConditionExpressions, and the in-memory test fake evaluates them directly.
 * Nothing in this file imports the AWS SDK, so the pure core (and its
 * replay/authorization tests) run without any AWS dependency.
 *
 * Table shape (single table, PAY_PER_REQUEST, TTL on `ttl`):
 *   - Session meta item:  pk=`SESSION#<sessionId>`  sk=`#META`
 *   - Nonce item:         pk=`SESSION#<sessionId>`  sk=`NONCE#<nonce>`
 * Both carry `ttl` (epoch SECONDS) so DynamoDB expires abandoned sessions
 * and their nonce guards together.
 */

// ---------------------------------------------------------------------------
// DynamoPort — the narrow command surface the store needs.
// ---------------------------------------------------------------------------

export type DynamoCondition =
  | { kind: "attribute_not_exists"; attribute: string }
  | { kind: "attribute_exists"; attribute: string }
  | { kind: "equals"; attribute: string; value: string | number | boolean }
  | { kind: "greater_than"; attribute: string; value: number }
  | { kind: "and"; conditions: DynamoCondition[] };

export type DynamoWriteResult =
  | { ok: true; item?: Record<string, unknown> }
  | { ok: false; conditionFailed: true };

export interface DynamoPutInput {
  item: Record<string, unknown>;
  condition?: DynamoCondition;
}

export interface DynamoUpdateInput {
  key: { pk: string; sk: string };
  /** Attributes to set. */
  set: Record<string, unknown>;
  condition?: DynamoCondition;
  /** When true, a successful update returns the new item (ALL_NEW). */
  returnUpdated?: boolean;
}

/**
 * Minimal single-table DynamoDB port. `put`/`update` honor an optional
 * structured condition and report a condition failure as a typed result
 * (never a thrown ConditionalCheckFailedException) so callers branch on it.
 */
export interface DynamoPort {
  put(input: DynamoPutInput): Promise<DynamoWriteResult>;
  get(key: { pk: string; sk: string }): Promise<Record<string, unknown> | null>;
  update(input: DynamoUpdateInput): Promise<DynamoWriteResult>;
  delete(key: { pk: string; sk: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Session state shape
// ---------------------------------------------------------------------------

export type BrokerSessionStatus = "active" | "expired" | "cancelled" | "closed";

export interface BrokerSessionState {
  sessionId: string;
  tenantId: string;
  audience: string;
  /** Base64 SPKI-DER Ed25519 public key registered by the trusted host. */
  publicKey: string;
  contextFingerprint: string;
  principalMode: string;
  /** Subject id ("" when the mode resolves at action time). */
  subjectId: string;
  /** Exact grant/contract snapshot at mint — an upper bound, not cached authz. */
  grantSnapshot: Record<string, unknown>;
  budgets: Record<string, unknown>;
  /** The next sequence the session will accept (starts at 0). */
  nextSequence: number;
  cancelled: boolean;
  status: BrokerSessionStatus;
  /** Durable pg capability_broker_sessions.id for evidence linkage. */
  brokerSessionRowId: string;
  routineExecutionId: string | null;
  threadTurnId: string | null;
  createdEpochMs: number;
  /** Epoch SECONDS; the DynamoDB TTL attribute. */
  expiresEpochSeconds: number;
}

export interface CreateSessionInput {
  sessionId: string;
  tenantId: string;
  audience: string;
  publicKey: string;
  contextFingerprint: string;
  principalMode: string;
  subjectId?: string;
  grantSnapshot?: Record<string, unknown>;
  budgets?: Record<string, unknown>;
  brokerSessionRowId: string;
  routineExecutionId?: string | null;
  threadTurnId?: string | null;
  createdEpochMs: number;
  expiresEpochSeconds: number;
}

const META_SK = "#META";
const TTL_ATTR = "ttl";

function sessionPk(sessionId: string): string {
  return `SESSION#${sessionId}`;
}

function noncePk(sessionId: string): string {
  return sessionPk(sessionId);
}

function nonceSk(nonce: string): string {
  return `NONCE#${nonce}`;
}

// ---------------------------------------------------------------------------
// create / load
// ---------------------------------------------------------------------------

/**
 * Register a new session. Only the PUBLIC key is stored — the trusted host
 * keeps the private key and never persists it here. Conditional on the
 * session id not already existing (idempotency guard, never a widen path).
 */
export async function createSession(
  client: DynamoPort,
  table: string,
  input: CreateSessionInput,
): Promise<{ ok: true } | { ok: false; conflict: true }> {
  const item: Record<string, unknown> = {
    pk: sessionPk(input.sessionId),
    sk: META_SK,
    table,
    type: "session",
    sessionId: input.sessionId,
    tenantId: input.tenantId,
    audience: input.audience,
    publicKey: input.publicKey,
    contextFingerprint: input.contextFingerprint,
    principalMode: input.principalMode,
    subjectId: input.subjectId ?? "",
    grantSnapshot: JSON.stringify(input.grantSnapshot ?? {}),
    budgets: JSON.stringify(input.budgets ?? {}),
    nextSequence: 0,
    cancelled: false,
    status: "active",
    brokerSessionRowId: input.brokerSessionRowId,
    routineExecutionId: input.routineExecutionId ?? null,
    threadTurnId: input.threadTurnId ?? null,
    createdEpochMs: input.createdEpochMs,
    [TTL_ATTR]: input.expiresEpochSeconds,
  };
  const res = await client.put({
    item,
    condition: { kind: "attribute_not_exists", attribute: "pk" },
  });
  return res.ok ? { ok: true } : { ok: false, conflict: true };
}

function parseSession(raw: Record<string, unknown>): BrokerSessionState {
  const asObject = (v: unknown): Record<string, unknown> => {
    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    }
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  };
  const asString = (v: unknown): string => (typeof v === "string" ? v : "");
  const asNumber = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;
  const status = asString(raw.status);
  return {
    sessionId: asString(raw.sessionId),
    tenantId: asString(raw.tenantId),
    audience: asString(raw.audience),
    publicKey: asString(raw.publicKey),
    contextFingerprint: asString(raw.contextFingerprint),
    principalMode: asString(raw.principalMode),
    subjectId: asString(raw.subjectId),
    grantSnapshot: asObject(raw.grantSnapshot),
    budgets: asObject(raw.budgets),
    nextSequence: asNumber(raw.nextSequence),
    cancelled: raw.cancelled === true,
    status:
      status === "active" ||
      status === "expired" ||
      status === "cancelled" ||
      status === "closed"
        ? status
        : "expired",
    brokerSessionRowId: asString(raw.brokerSessionRowId),
    routineExecutionId:
      typeof raw.routineExecutionId === "string"
        ? raw.routineExecutionId
        : null,
    threadTurnId:
      typeof raw.threadTurnId === "string" ? raw.threadTurnId : null,
    createdEpochMs: asNumber(raw.createdEpochMs),
    expiresEpochSeconds: asNumber(raw[TTL_ATTR]),
  };
}

/** Load the session meta item, or null when absent (TTL-expired or unknown). */
export async function loadSession(
  client: DynamoPort,
  table: string,
  sessionId: string,
): Promise<BrokerSessionState | null> {
  void table;
  const raw = await client.get({ pk: sessionPk(sessionId), sk: META_SK });
  if (!raw) return null;
  return parseSession(raw);
}

// ---------------------------------------------------------------------------
// consume sequence (conditional) — the atomic ordering gate
// ---------------------------------------------------------------------------

export type ConsumeSequenceResult =
  | { ok: true; nextSequence: number }
  | { ok: false; reason: "sequence_conflict" };

/**
 * Atomically advance the session's next sequence from `expected` to
 * `expected + 1`. The ConditionExpression asserts the CURRENT next sequence
 * equals `expected` AND the session is neither cancelled nor closed, so two
 * concurrent requests for the same sequence produce exactly one success and
 * one `sequence_conflict`. Expiry/cancellation are surfaced by the caller's
 * pre-check on the loaded session; a conflict here is an out-of-order or
 * replayed sequence.
 */
export async function consumeSequence(
  client: DynamoPort,
  table: string,
  sessionId: string,
  expected: number,
): Promise<ConsumeSequenceResult> {
  void table;
  const res = await client.update({
    key: { pk: sessionPk(sessionId), sk: META_SK },
    set: { nextSequence: expected + 1 },
    condition: {
      kind: "and",
      conditions: [
        { kind: "equals", attribute: "nextSequence", value: expected },
        { kind: "equals", attribute: "cancelled", value: false },
        { kind: "equals", attribute: "status", value: "active" },
      ],
    },
    returnUpdated: true,
  });
  if (!res.ok) return { ok: false, reason: "sequence_conflict" };
  return { ok: true, nextSequence: expected + 1 };
}

// ---------------------------------------------------------------------------
// record nonce (conditional) — replay rejection
// ---------------------------------------------------------------------------

export type RecordNonceResult =
  | { ok: true }
  | { ok: false; reason: "replay_rejected" };

/**
 * Write a unique session+nonce record. Conditional on the nonce not already
 * existing, so a reused nonce (even with a fresh sequence) is rejected before
 * any downstream work. The nonce inherits the session TTL so guards expire
 * with the session.
 */
export async function recordNonce(
  client: DynamoPort,
  table: string,
  sessionId: string,
  nonce: string,
  expiresEpochSeconds: number,
): Promise<RecordNonceResult> {
  void table;
  const res = await client.put({
    item: {
      pk: noncePk(sessionId),
      sk: nonceSk(nonce),
      type: "nonce",
      sessionId,
      nonce,
      [TTL_ATTR]: expiresEpochSeconds,
    },
    condition: { kind: "attribute_not_exists", attribute: "sk" },
  });
  return res.ok ? { ok: true } : { ok: false, reason: "replay_rejected" };
}

// ---------------------------------------------------------------------------
// cancellation / close
// ---------------------------------------------------------------------------

/**
 * Flip the session's cancellation flag. Conditional on the session existing;
 * cancellation takes effect on the NEXT sequence consume (the flag is part of
 * the consumeSequence condition), so an in-flight request is not torn down but
 * no further request can consume a sequence.
 */
export async function requestCancellation(
  client: DynamoPort,
  table: string,
  sessionId: string,
): Promise<{ ok: true } | { ok: false; notFound: true }> {
  void table;
  const res = await client.update({
    key: { pk: sessionPk(sessionId), sk: META_SK },
    set: { cancelled: true, status: "cancelled" },
    condition: { kind: "attribute_exists", attribute: "pk" },
  });
  return res.ok ? { ok: true } : { ok: false, notFound: true };
}

/** Mark a session closed (trusted teardown after a run completes). */
export async function closeSession(
  client: DynamoPort,
  table: string,
  sessionId: string,
  closedEpochMs: number,
): Promise<{ ok: true } | { ok: false; notFound: true }> {
  void table;
  const res = await client.update({
    key: { pk: sessionPk(sessionId), sk: META_SK },
    set: { status: "closed", closedEpochMs },
    condition: { kind: "attribute_exists", attribute: "pk" },
  });
  return res.ok ? { ok: true } : { ok: false, notFound: true };
}

export const _internals = {
  META_SK,
  TTL_ATTR,
  sessionPk,
  nonceSk,
};
