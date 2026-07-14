/**
 * Capability Broker Lambda (THINK-280 U3, U5; execution wired).
 *
 * The dedicated broker's private data endpoint. It runs a SESSIONED,
 * replay-safe proof-of-possession protocol and, only after exhaustive
 * action-time authorization, resolves the binding's credentials and dispatches
 * through the adapter registry (U5 installs the `http_openapi` and `platform`
 * adapters). The production handler wires a real DB-backed authorization loader
 * (`createDrizzleAuthorizationLoader`) that re-authorizes every call against the
 * current admitted contract, credential binding, grant, approval, and budget —
 * fail-closed on any missing/drifted row. The adapters + credential resolver are
 * also exercised via injected deps in tests.
 *
 * Strict order for a call request (nothing later runs until each step passes):
 *   parse/canonicalize → load session → verify audience/signature/clock →
 *   atomically CONSUME the sequence (conditional) → RECORD the nonce
 *   (conditional, replay-reject) → re-authorize from freshly reloaded state →
 *   resolve credentials (only after an installed adapter is found) → dispatch
 *   adapter → validate/classify → persist evidence → return a safe envelope.
 *   Sequence + nonce are consumed BEFORE any policy/credential/adapter work, so
 *   a replay is rejected without downstream effect.
 *
 * Lost-response safety: the durable `capability_broker_calls` row is written
 * `authorized` BEFORE dispatch and finalized after. A signed STATUS request
 * returns the recorded outcome and NEVER re-dispatches. A finalize failure
 * after a provider effect leaves the row `indeterminate` for operator
 * reconciliation — never an automatic redispatch.
 *
 * The broker NEVER throws to the caller: every failure is a typed
 * {@link BrokerCallEnvelope}.
 */

import { createPublicKey, verify as edVerify } from "node:crypto";

import {
  buildSignableCallPayload,
  buildSignableStatusPayload,
  checkClockWindow,
  parseTwcapRef,
  type BrokerCallEnvelope,
  type BrokerCallRequest,
  type BrokerCallResult,
  type BrokerErrorCategory,
  type BrokerStatusRequest,
  type CanonicalJson,
  type OperationEffect,
  type AdapterKind,
  type OperationContract,
  type BindingReadinessState,
  type PrincipalMode,
  type TwcapReference,
  INLINE_RESULT_MAX_BYTES,
} from "@thinkwork/capability-contracts";

import {
  consumeSequence,
  loadSession,
  recordNonce,
  type BrokerSessionState,
  type DynamoPort,
} from "./lib/capability-broker/sessions.js";
import {
  authorizeAction,
  type PolicyDecision,
} from "./lib/capability-broker/policy.js";
import {
  digestRequestInput,
  digestResult,
  type BrokerCallEvidenceRow,
  type BrokerCallStatus,
  type EvidenceStore,
  type StoredBrokerCall,
} from "./lib/capability-broker/evidence.js";
import {
  buildCapabilityAdapterRegistry,
  type AdapterDispatchOutcome,
  type AdapterRegistry,
} from "./lib/capability-broker/adapters/registry.js";
import {
  createPassthroughCredentialResolver,
  createSecretsManagerCredentialResolver,
  type CredentialResolver,
} from "./lib/capability-broker/credential-resolver.js";

// ---------------------------------------------------------------------------
// Re-authorization seam
// ---------------------------------------------------------------------------

/**
 * Freshly reloaded authorization state for one operation. The broker calls
 * this on EVERY request — the session snapshot is an upper bound, never cached
 * authorization. The production handler injects the DB-backed
 * `createDrizzleAuthorizationLoader`; `denyingAuthorizationLoader` remains the
 * fail-closed default a misconfigured deployment falls back to.
 */
export interface AuthorizationSnapshot {
  definitionVersionId: string | null;
  operation: OperationContract | null;
  currentContractHash: string | null;
  adapterKind: AdapterKind | null;
  grant: { allowedEffects: OperationEffect[] } | null;
  binding: {
    id: string;
    readiness: BindingReadinessState;
    principalMode: PrincipalMode;
    subjectId: string;
    credentialRefs: Record<string, string>;
  } | null;
  approval: { policy: "never" | "once" | "always"; satisfied: boolean };
  budget: {
    withinLimits: boolean;
    reason?: string;
    delta?: Record<string, unknown>;
  };
}

export type AuthorizationLoader = (params: {
  session: BrokerSessionState;
  operationRef: TwcapReference;
  rawOperation: string;
}) => Promise<AuthorizationSnapshot>;

export interface BrokerDeps {
  dynamo: DynamoPort;
  table: string;
  evidence: EvidenceStore;
  registry: AdapterRegistry;
  loadAuthorization: AuthorizationLoader;
  /**
   * Credential-resolution seam. Resolves the binding's vault references to
   * secret handles INSIDE the broker, immediately before dispatch and only
   * once an installed adapter is found. Defaults to a no-op passthrough that
   * reads no secrets (empty handles) so the pure core needs no vault access;
   * the handler injects the SecretsManager-backed resolver and tests inject
   * fakes.
   */
  credentialResolver?: CredentialResolver;
  /** Epoch milliseconds. */
  now: () => number;
  /** Provider-call wall-clock budget in ms (applied to accepted adapters). */
  dispatchDeadlineMs?: number;
}

// ---------------------------------------------------------------------------
// Wire request
// ---------------------------------------------------------------------------

export type BrokerWireRequest =
  | { kind: "call"; request: BrokerCallRequest; signature: string }
  | { kind: "status"; request: BrokerStatusRequest; signature: string };

function fail(
  category: BrokerErrorCategory,
  message: string,
  retryable = false,
): BrokerCallResult {
  return { status: "failed", error: { category, retryable, message } };
}

function envelope(
  callId: string,
  sessionId: string,
  clientRequestId: string,
  operation: string,
  result: BrokerCallResult,
): BrokerCallEnvelope {
  return { callId, sessionId, clientRequestId, operation, result };
}

// ---------------------------------------------------------------------------
// Signature verification (session public key over the canonical signable bytes)
// ---------------------------------------------------------------------------

function verifySessionSignature(
  publicKeyB64: string,
  signable: string,
  signatureB64: string,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyB64, "base64"),
      format: "der",
      type: "spki",
    });
    return edVerify(
      null,
      Buffer.from(signable, "utf8"),
      key,
      Buffer.from(signatureB64, "base64"),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Broker core
// ---------------------------------------------------------------------------

export function createBroker(deps: BrokerDeps) {
  const now = deps.now;
  const credentialResolver =
    deps.credentialResolver ?? createPassthroughCredentialResolver();

  /** Build a base evidence row shared by rejected and authorized inserts. */
  function baseRow(
    session: BrokerSessionState,
    request: BrokerCallRequest,
    operationRef: string,
  ): BrokerCallEvidenceRow {
    return {
      tenant_id: session.tenantId,
      broker_session_id: session.brokerSessionRowId,
      client_request_id: request.clientRequestId,
      sequence: request.sequence,
      operation_ref: operationRef,
      contract_hash: null,
      definition_version_id: null,
      binding_id: null,
      status: "rejected",
      policy_decisions_json: {},
      request_digest: safeDigest(request.input),
      result_digest: null,
      error_category: null,
      effect: null,
      budget_delta_json: {},
      adapter_kind: null,
      duration_ms: null,
      durable_ref_json: null,
      routine_execution_id: session.routineExecutionId,
      thread_turn_id: session.threadTurnId,
      compliance_event_id: null,
      authorized_at: null,
      finalized_at: null,
    };
  }

  function safeDigest(input: CanonicalJson): string | null {
    try {
      return digestRequestInput(input);
    } catch {
      return null;
    }
  }

  /** Persist a rejection row (best-effort — a rejection is still evidence). */
  async function recordRejection(
    row: BrokerCallEvidenceRow,
    category: BrokerErrorCategory,
    decisions: Record<string, unknown>,
  ): Promise<void> {
    try {
      await deps.evidence.insert({
        ...row,
        status: "rejected",
        error_category: category,
        policy_decisions_json: decisions,
        finalized_at: new Date(now()),
      });
    } catch {
      // Evidence write failures on a rejection must not change the response —
      // the caller still receives the typed rejection envelope.
    }
  }

  async function handleCall(
    request: BrokerCallRequest,
    signature: string,
  ): Promise<BrokerCallEnvelope> {
    const started = now();

    // 1. Parse the twcap operation reference (fail closed).
    let opRef: TwcapReference;
    try {
      opRef = parseTwcapRef(request.operation);
    } catch {
      return envelope(
        "",
        request.sessionId,
        request.clientRequestId,
        request.operation,
        fail("invalid_request", "malformed operation reference"),
      );
    }

    // 2. Load the session.
    const session = await loadSession(
      deps.dynamo,
      deps.table,
      request.sessionId,
    );
    if (!session) {
      return envelope(
        "",
        request.sessionId,
        request.clientRequestId,
        request.operation,
        fail("session_expired", "session not found or expired"),
      );
    }
    const nowMs = now();
    if (session.status === "cancelled" || session.cancelled) {
      return envelope(
        "",
        session.sessionId,
        request.clientRequestId,
        request.operation,
        fail("session_cancelled", "session cancelled"),
      );
    }
    if (
      session.status !== "active" ||
      session.expiresEpochSeconds * 1000 <= nowMs
    ) {
      return envelope(
        "",
        session.sessionId,
        request.clientRequestId,
        request.operation,
        fail("session_expired", "session expired"),
      );
    }

    const row = baseRow(session, request, request.operation);

    // 3. Audience binding.
    // (audience is validated against the signed payload, but a mismatch is a
    //  cheap early reject before signature math.)
    // The signed payload covers the audience, so we bind to the SESSION audience.

    // 4. Signature over the canonical signable bytes (session public key).
    const signable = buildSignableCallPayload(session.audience, request);
    if (!verifySessionSignature(session.publicKey, signable, signature)) {
      await recordRejection(row, "unauthorized", { signature: "invalid" });
      return envelope(
        "",
        session.sessionId,
        request.clientRequestId,
        request.operation,
        fail("unauthorized", "signature verification failed"),
      );
    }

    // 5. Clock window.
    const clock = checkClockWindow(request.issuedAt, nowMs);
    if (!clock.ok) {
      await recordRejection(row, "invalid_request", { clock: clock.reason });
      return envelope(
        "",
        session.sessionId,
        request.clientRequestId,
        request.operation,
        fail("invalid_request", `clock ${clock.reason}`),
      );
    }

    // 6. Consume the sequence (atomic) BEFORE any downstream work.
    const seq = await consumeSequence(
      deps.dynamo,
      deps.table,
      session.sessionId,
      request.sequence,
    );
    if (!seq.ok) {
      await recordRejection(row, "replay_rejected", { sequence: "conflict" });
      return envelope(
        "",
        session.sessionId,
        request.clientRequestId,
        request.operation,
        fail("replay_rejected", "sequence already consumed or out of order"),
      );
    }

    // 7. Record the nonce (replay reject) BEFORE any policy/credential/adapter work.
    const nonce = await recordNonce(
      deps.dynamo,
      deps.table,
      session.sessionId,
      request.nonce,
      session.expiresEpochSeconds,
    );
    if (!nonce.ok) {
      await recordRejection(row, "replay_rejected", { nonce: "replayed" });
      return envelope(
        "",
        session.sessionId,
        request.clientRequestId,
        request.operation,
        fail("replay_rejected", "nonce already seen"),
      );
    }

    // 8. Re-authorize from freshly reloaded state.
    let snapshot: AuthorizationSnapshot;
    try {
      snapshot = await deps.loadAuthorization({
        session,
        operationRef: opRef,
        rawOperation: request.operation,
      });
    } catch (err) {
      // A reload failure with no server-side signal is undebuggable — log the
      // exception (never the request input, which may carry provider data) so
      // an operator can tell a DB/network fault from a code fault.
      console.error(
        `[capability-broker] authorization reload threw for operation=${request.operation}: ${
          err instanceof Error ? `${err.name}: ${err.message}` : String(err)
        }`,
      );
      await recordRejection(row, "policy_blocked", {
        authorization: "reload_failed",
      });
      return envelope(
        "",
        session.sessionId,
        request.clientRequestId,
        request.operation,
        fail("policy_blocked", "authorization reload failed"),
      );
    }

    row.contract_hash = opRef.contractHash;
    row.definition_version_id = snapshot.definitionVersionId;
    row.binding_id = snapshot.binding?.id ?? null;
    row.adapter_kind = snapshot.adapterKind;

    const decision: PolicyDecision = authorizeAction(
      {
        operation: snapshot.operation,
        currentContractHash: snapshot.currentContractHash,
        grant: snapshot.grant,
        binding: snapshot.binding
          ? {
              readiness: snapshot.binding.readiness,
              principalMode: snapshot.binding.principalMode,
              subjectId: snapshot.binding.subjectId,
            }
          : null,
        approval: snapshot.approval,
        budget: snapshot.budget,
      },
      {
        requestedContractHash: opRef.contractHash,
        principal: {
          mode: session.principalMode as PrincipalMode,
          subjectId: session.subjectId,
        },
      },
    );

    if (!decision.allowed) {
      await recordRejection(row, decision.category, decision.decisions);
      return envelope(
        "",
        session.sessionId,
        request.clientRequestId,
        request.operation,
        fail(decision.category, decision.reason),
      );
    }

    // 9. Durable authorized row BEFORE credential resolution/dispatch.
    let callId: string;
    try {
      const inserted = await deps.evidence.insert({
        ...row,
        status: "authorized",
        effect: decision.effect,
        policy_decisions_json: decision.decisions,
        budget_delta_json: snapshot.budget.delta ?? {},
        authorized_at: new Date(now()),
      });
      callId = inserted.id;
    } catch {
      // Cannot create the durable authorized row → do NOT dispatch (no evidence
      // means no safe reconstruction). Fail closed.
      return envelope(
        "",
        session.sessionId,
        request.clientRequestId,
        request.operation,
        fail("indeterminate", "could not record authorization evidence"),
      );
    }

    // 10. Credential resolution seam + dispatch. Credentials are resolved INSIDE
    // `dispatch` — only after an installed adapter is found — so an
    // unavailable-adapter call never touches the vault, and resolved secrets are
    // handed straight to the adapter without ever entering this scope.
    const outcome = await dispatch(session, snapshot, request, callId);

    // 12. Normalize + validate the outcome, then finalize evidence.
    const { result, status, resultDigest, durable, errorCategory } =
      normalizeOutcome(outcome);

    try {
      await deps.evidence.finalize(callId, {
        status,
        result_digest: resultDigest,
        error_category: errorCategory,
        duration_ms: now() - started,
        durable_ref_json: durable,
        finalized_at: new Date(now()),
      });
    } catch {
      // Terminal-ledger failure AFTER a possible provider effect → leave the
      // row indeterminate for operator reconciliation; NEVER redispatch.
      try {
        await deps.evidence.finalize(callId, {
          status: "indeterminate",
          error_category: "indeterminate",
          duration_ms: now() - started,
          finalized_at: new Date(now()),
        });
      } catch {
        // If even the indeterminate marker cannot be written, the row remains
        // `authorized`; the operator reconciliation reader treats a stuck
        // `authorized` row identically.
      }
      return envelope(
        callId,
        session.sessionId,
        request.clientRequestId,
        request.operation,
        fail(
          "indeterminate",
          "provider outcome recorded ambiguously; operator reconciliation required",
        ),
      );
    }

    return envelope(
      callId,
      session.sessionId,
      request.clientRequestId,
      request.operation,
      result,
    );
  }

  async function dispatch(
    session: BrokerSessionState,
    snapshot: AuthorizationSnapshot,
    request: BrokerCallRequest,
    callId: string,
  ): Promise<AdapterDispatchOutcome> {
    if (!snapshot.adapterKind || !snapshot.operation) {
      return {
        status: "failed",
        category: "unavailable_adapter",
        message: "no adapter kind resolved for the operation",
        retryable: false,
      };
    }
    const adapter = deps.registry.lookup(snapshot.adapterKind);
    if (!adapter) {
      // A permitted call to an uninstalled adapter has NO side effect (and no
      // credential is resolved) and returns typed unavailable_adapter evidence.
      return {
        status: "failed",
        category: "unavailable_adapter",
        message: `no installed adapter for kind ${snapshot.adapterKind}`,
        retryable: false,
      };
    }

    // Resolve the binding's vault references to secret handles. A resolution
    // failure is a typed failure and NO dispatch happens — the adapter never
    // sees a reference, and resolved material stays out of this scope's return.
    const credentialRefs = snapshot.binding?.credentialRefs ?? {};
    const resolution =
      await credentialResolver.resolveCredentialRefs(credentialRefs);
    if (!resolution.ok) {
      return {
        status: "failed",
        category: resolution.category,
        message: resolution.message,
        retryable: false,
      };
    }

    return adapter.dispatch({
      tenantId: session.tenantId,
      operationRef: request.operation,
      contract: snapshot.operation,
      input: request.input,
      principal: {
        mode:
          snapshot.binding?.principalMode ??
          (session.principalMode as PrincipalMode),
        subjectId: snapshot.binding?.subjectId ?? session.subjectId,
      },
      credentialRefs,
      credentials: resolution.credentials,
      provenance: {
        routineExecutionId: session.routineExecutionId ?? null,
        threadTurnId: session.threadTurnId ?? null,
        brokerCallId: callId,
      },
      deadlineEpochMs: now() + (deps.dispatchDeadlineMs ?? 15000),
    });
  }

  function normalizeOutcome(outcome: AdapterDispatchOutcome): {
    result: BrokerCallResult;
    status: BrokerCallStatus;
    resultDigest: string | null;
    durable: Record<string, unknown> | null;
    errorCategory: string | null;
  } {
    if (outcome.status === "completed") {
      if (outcome.data !== undefined) {
        // Enforce the inline cap over canonical bytes.
        let bytes = Number.POSITIVE_INFINITY;
        let digest: string | null = null;
        try {
          digest = digestResult(outcome.data);
          bytes = Buffer.byteLength(JSON.stringify(outcome.data), "utf8");
        } catch {
          bytes = Number.POSITIVE_INFINITY;
        }
        if (bytes > INLINE_RESULT_MAX_BYTES) {
          return {
            result: fail(
              "adapter_error",
              "inline result exceeded 64 KiB cap without a durable reference",
            ),
            status: "failed",
            resultDigest: digest,
            durable: null,
            errorCategory: "adapter_error",
          };
        }
        return {
          result: { status: "completed", data: outcome.data },
          status: "completed",
          resultDigest: digest,
          durable: null,
          errorCategory: null,
        };
      }
      const durableRef = outcome.durable
        ? (outcome.durable as unknown as Record<string, unknown>)
        : null;
      return {
        result: outcome.durable
          ? { status: "completed", durableRef: outcome.durable }
          : { status: "completed" },
        status: "completed",
        resultDigest: null,
        durable: durableRef,
        errorCategory: null,
      };
    }
    if (outcome.status === "accepted") {
      return {
        result: {
          status: "accepted",
          pollToken: outcome.pollToken,
          cancellable: outcome.cancellable,
        },
        status: "accepted",
        resultDigest: null,
        durable: null,
        errorCategory: null,
      };
    }
    return {
      result: fail(outcome.category, outcome.message, outcome.retryable),
      status: "failed",
      resultDigest: null,
      durable: null,
      errorCategory: outcome.category,
    };
  }

  // -------------------------------------------------------------------------
  // Signed STATUS request — return the recorded outcome; NEVER redispatch.
  // -------------------------------------------------------------------------

  async function handleStatus(
    request: BrokerStatusRequest,
    signature: string,
  ): Promise<BrokerCallEnvelope> {
    const session = await loadSession(
      deps.dynamo,
      deps.table,
      request.sessionId,
    );
    if (!session) {
      return envelope(
        "",
        request.sessionId,
        request.clientRequestId,
        "",
        fail("session_expired", "session not found or expired"),
      );
    }
    const nowMs = now();
    if (session.status === "cancelled" || session.cancelled) {
      return envelope(
        "",
        session.sessionId,
        request.clientRequestId,
        "",
        fail("session_cancelled", "session cancelled"),
      );
    }
    if (
      session.status !== "active" ||
      session.expiresEpochSeconds * 1000 <= nowMs
    ) {
      return envelope(
        "",
        session.sessionId,
        request.clientRequestId,
        "",
        fail("session_expired", "session expired"),
      );
    }

    const signable = buildSignableStatusPayload(session.audience, request);
    if (!verifySessionSignature(session.publicKey, signable, signature)) {
      return envelope(
        "",
        session.sessionId,
        request.clientRequestId,
        "",
        fail("unauthorized", "signature verification failed"),
      );
    }
    const clock = checkClockWindow(request.issuedAt, nowMs);
    if (!clock.ok) {
      return envelope(
        "",
        session.sessionId,
        request.clientRequestId,
        "",
        fail("invalid_request", `clock ${clock.reason}`),
      );
    }

    // Status requests still consume their own sequence + nonce (they are signed
    // calls that must not themselves be replayable).
    const seq = await consumeSequence(
      deps.dynamo,
      deps.table,
      session.sessionId,
      request.sequence,
    );
    if (!seq.ok) {
      return envelope(
        "",
        session.sessionId,
        request.clientRequestId,
        "",
        fail("replay_rejected", "sequence already consumed or out of order"),
      );
    }
    const nonce = await recordNonce(
      deps.dynamo,
      deps.table,
      session.sessionId,
      request.nonce,
      session.expiresEpochSeconds,
    );
    if (!nonce.ok) {
      return envelope(
        "",
        session.sessionId,
        request.clientRequestId,
        "",
        fail("replay_rejected", "nonce already seen"),
      );
    }

    // Look up the recorded outcome of the SUBJECT call. No adapter is touched.
    const recorded = await deps.evidence.findByClientRequestId(
      session.brokerSessionRowId,
      request.subjectClientRequestId,
    );
    if (!recorded) {
      return envelope(
        "",
        session.sessionId,
        request.clientRequestId,
        "",
        fail(
          "invalid_request",
          "no recorded call for the requested client request id",
        ),
      );
    }
    return envelope(
      recorded.id,
      session.sessionId,
      request.subjectClientRequestId,
      recorded.operation_ref ?? "",
      reconstructResult(recorded),
    );
  }

  return { handleCall, handleStatus, process: processWire };

  async function processWire(
    wire: BrokerWireRequest,
  ): Promise<BrokerCallEnvelope> {
    try {
      if (wire.kind === "status") {
        return await handleStatus(wire.request, wire.signature);
      }
      return await handleCall(wire.request, wire.signature);
    } catch {
      // The broker never throws to the caller.
      const sid = (wire.request as { sessionId?: string }).sessionId ?? "";
      const crid =
        (wire.request as { clientRequestId?: string }).clientRequestId ?? "";
      return envelope(
        "",
        sid,
        crid,
        "",
        fail("indeterminate", "internal broker error"),
      );
    }
  }
}

/** Reconstruct the recorded result from a durable evidence row (no redispatch). */
function reconstructResult(row: StoredBrokerCall): BrokerCallResult {
  switch (row.status) {
    case "completed":
      return row.durable_ref_json
        ? ({
            status: "completed",
            durableRef: row.durable_ref_json,
          } as unknown as BrokerCallResult)
        : // Inline data is not retained in evidence (only its digest); the
          // recorded completion is reported without the body.
          { status: "completed" };
    case "accepted":
      // Accepted work is polled through the recorded poll token elsewhere;
      // report the terminal recorded state.
      return {
        status: "accepted",
        pollToken: row.id,
        cancellable: false,
      };
    case "indeterminate":
      return fail(
        "indeterminate",
        "recorded outcome is indeterminate; operator reconciliation required",
      );
    case "authorized":
      return fail(
        "indeterminate",
        "call authorized but never finalized; operator reconciliation required",
      );
    case "failed":
    case "rejected":
    default:
      return fail(
        (row.error_category as BrokerErrorCategory) ?? "indeterminate",
        "recorded failure",
      );
  }
}

// ---------------------------------------------------------------------------
// HTTP entry point (inert: default loader denies everything until U-later wires it)
// ---------------------------------------------------------------------------

/** Wrapped per the vitest env-capture rule — never read process.env at module load. */
function getSessionTableName(): string {
  return process.env.CAPABILITY_BROKER_SESSION_TABLE ?? "";
}

function getBrokerAudience(): string {
  return process.env.CAPABILITY_BROKER_AUDIENCE ?? "";
}

function getAwsRegion(): string {
  return process.env.AWS_REGION || "us-east-1";
}

/**
 * The production authorization loader is DELIBERATELY fail-closed in this
 * slice: it returns an empty snapshot so the policy denies every request
 * (`grant_removed`). No dispatch is possible until the DB-backed loader is
 * wired in a later unit. Tests inject their own loader to exercise the full
 * machinery through to `unavailable_adapter`.
 */
/**
 * Fail-closed authorization default: denies every request. The production
 * handler wires the real DB-backed loader (`createDrizzleAuthorizationLoader`);
 * this remains the safe default a misconfigured deployment falls back to and the
 * baseline tests assert against.
 */
export const denyingAuthorizationLoader: AuthorizationLoader = async () => ({
  definitionVersionId: null,
  operation: null,
  currentContractHash: null,
  adapterKind: null,
  grant: null,
  binding: null,
  approval: { policy: "always", satisfied: false },
  budget: { withinLimits: false, reason: "authorization_not_wired" },
});

function parseWire(body: string): BrokerWireRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const p = parsed as Record<string, unknown>;
  if (
    (p.kind !== "call" && p.kind !== "status") ||
    typeof p.signature !== "string"
  ) {
    return null;
  }
  if (!p.request || typeof p.request !== "object" || Array.isArray(p.request)) {
    return null;
  }
  return {
    kind: p.kind,
    request: p.request as BrokerCallRequest & BrokerStatusRequest,
    signature: p.signature,
  } as BrokerWireRequest;
}

interface HttpEventLike {
  body?: string | null;
  requestContext?: { http?: { method?: string } };
}

/**
 * Lambda handler. Always returns HTTP 200 with a typed broker envelope in the
 * body (the broker's failures are typed, not HTTP errors) except for genuinely
 * malformed transport, which is a 400.
 */
export async function handler(event: HttpEventLike): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}> {
  const method = event.requestContext?.http?.method;
  if (method && method !== "POST") {
    return json(405, { error: "Method not allowed — POST only" });
  }
  const wire = parseWire(event.body ?? "");
  if (!wire) {
    return json(400, { error: "malformed broker request" });
  }
  const table = getSessionTableName();
  if (!table) {
    return json(500, { error: "CAPABILITY_BROKER_SESSION_TABLE unset" });
  }

  // Build the real dependencies lazily (dynamic import mirrors the analyst
  // broker's SDK-as-devDep pattern; keeps the pure core SDK-free).
  const { createDynamoPort, DynamoDBClient } =
    await import("./lib/capability-broker/dynamo-port.js");
  const client = new DynamoDBClient({ region: getAwsRegion() });
  const dynamo = createDynamoPort(client, table);

  const evidence = await buildDrizzleEvidence();

  const { createDrizzlePlatformArtifactWriter } =
    await import("./lib/capability-broker/adapters/platform-artifact-writer.js");
  const registry = buildCapabilityAdapterRegistry({
    artifactWriter: createDrizzlePlatformArtifactWriter(),
  });

  // Real DB-backed authorization: resolve the pinned operation to its current
  // admitted contract, credential binding, grant, approval, and budget on EVERY
  // call (never cached from the session). Fail-closed — any missing/drifted row
  // yields a snapshot the pure policy rejects.
  const { getDb } = await import("@thinkwork/database-pg");
  const schema = await import("@thinkwork/database-pg/schema");
  const { createDrizzleAuthorizationLoader } =
    await import("./lib/capability-broker/authorization-loader.js");
  const loadAuthorization = createDrizzleAuthorizationLoader({
    db: getDb(),
    schema: schema as unknown as Parameters<
      typeof createDrizzleAuthorizationLoader
    >[0]["schema"],
  });

  const broker = createBroker({
    dynamo,
    table,
    evidence,
    registry,
    loadAuthorization,
    credentialResolver: createSecretsManagerCredentialResolver({
      region: getAwsRegion(),
    }),
    now: () => Date.now(),
  });

  // The signed payload binds the SESSION audience; the deployed audience is a
  // deploy-time invariant surfaced for operators/log correlation only.
  void getBrokerAudience();

  const result = await broker.process(wire);
  return json(200, result);
}

async function buildDrizzleEvidence(): Promise<EvidenceStore> {
  const { getDb } = await import("@thinkwork/database-pg");
  const schema = await import("@thinkwork/database-pg/schema");
  const { eq, and } = await import("drizzle-orm");
  const { createDrizzleEvidenceStore } =
    await import("./lib/capability-broker/evidence.js");
  const table = (schema as Record<string, unknown>).capabilityBrokerCalls;
  const db = getDb() as unknown as Parameters<
    typeof createDrizzleEvidenceStore
  >[0]["db"];
  const cols = table as unknown as {
    id: unknown;
    broker_session_id: unknown;
    client_request_id: unknown;
  };
  return createDrizzleEvidenceStore({
    db,
    table,
    columns: {
      id: cols.id,
      broker_session_id: cols.broker_session_id,
      client_request_id: cols.client_request_id,
    },
    eq: eq as unknown as (a: unknown, b: unknown) => unknown,
    and: and as unknown as (...preds: unknown[]) => unknown,
  });
}

function json(
  statusCode: number,
  body: unknown,
): { statusCode: number; headers: Record<string, string>; body: string } {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
