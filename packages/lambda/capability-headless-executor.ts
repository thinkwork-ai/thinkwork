/**
 * capability-headless-executor — governed capability-headless Routine runs
 * (THINK-280 U7). This is where the FIRST production broker session is minted.
 *
 * The deterministic git_python executor (routine-exec-git) runs a validated
 * SHA in a sandbox with only its declared tenant credentials. A governed
 * capability run is different in three load-bearing ways, all enforced here:
 *
 *   1. It acts as an EXPLICIT service principal (execution_principal.mode =
 *      'service'). There is no fallback across principal modes — a run whose
 *      exact service binding is not ready is BLOCKED, never quietly retried as
 *      the requester (R6, AE2/AE8).
 *   2. BEFORE any sandbox or provider work, it resolves the exact validated
 *      SHA, the pinned dependency manifest (twcap + contract hashes), the
 *      config fingerprint, the current admitted contracts, the service
 *      binding readiness, and budgets. Any mismatch — contract drift, config
 *      fingerprint mismatch, stale approval, degraded/revoked binding —
 *      records a terminal blocked/degraded run + operator remediation and
 *      opens ZERO provider sessions (AE2/AE8, R15).
 *   3. On the happy path it mints a fresh, short-lived broker session
 *      (mintBrokerSession — mirrors the api trusted opener; packages/lambda
 *      cannot import @thinkwork/api), threads the session bootstrap into the
 *      capability-private Code Interpreter task, runs the exact cached SHA
 *      using ONLY the declared read + Artifact operations, records the full
 *      evidence chain, and closes/cancels the session in a finally path — a
 *      minted session is never left open.
 *
 * The module is pure over injected deps (db, python task runner, DynamoDB
 * session store, module loader, clock) so its acceptance tests run with zero
 * AWS and zero live provider calls.
 */

import { generateKeyPairSync, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@thinkwork/database-pg";
import {
  SESSION_MAX_TTL_SECONDS,
  canonicalSha256Hex,
  formatTwcapRef,
  type SessionBootstrap,
} from "@thinkwork/capability-contracts";
import {
  closeSession,
  createSession,
  type DynamoPort,
} from "./lib/capability-broker/sessions.js";
import {
  invokePythonTask,
  type PythonTaskInput,
  type PythonTaskResult,
} from "./routine-task-python.js";

const {
  routines,
  routineExecutions,
  routineStepEvents,
  routineCodeCache,
  capabilityBrokerSessions,
  capabilityBrokerCalls,
  capabilityCredentialBindings,
  capabilityDefinitionVersions,
  tenantServicePrincipals,
  tenants,
  inboxItems,
} = schema;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PrincipalMode = "requester" | "agent_owner" | "service";

/** execution_principal spec carried on the routine / agent_loop row. */
export interface ExecutionPrincipalSpec {
  mode: PrincipalMode;
  subjectId?: string | null;
  /** Required for 'service' mode — the tenant_service_principals row id. */
  servicePrincipalId?: string | null;
}

/** One pinned capability dependency (routines.capability_dependencies entry). */
export interface CapabilityDependency {
  /** twcap operation reference string. */
  twcap: string;
  /** Contract hash pinned at gate time. */
  contractHash: string;
  /** capability_definition_versions row id. */
  definitionVersionId: string;
  /** Operation id within the definition version (defaults from twcap fragment). */
  operationId?: string;
}

export type ReadinessOutcome = "ready" | "blocked" | "degraded";

export interface Remediation {
  /**
   * contract_drift | config_fingerprint_mismatch | stale_approval |
   * binding_missing | binding_not_ready | binding_degraded | binding_revoked |
   * service_principal_revoked | no_validated_sha | no_dependencies
   */
  kind: string;
  detail: string;
  servicePrincipalId?: string | null;
  bindingId?: string | null;
  definitionVersionId?: string | null;
}

export interface PreflightDecision {
  outcome: ReadinessOutcome;
  /** The exact validated SHA to execute (happy/degraded path). */
  execSha: string | null;
  configFingerprint: string;
  dependencies: CapabilityDependency[];
  /** Resolved binding id per dependency version (for evidence + step links). */
  bindingId: string | null;
  remediation?: Remediation;
}

/** One broker call the sandbox reported making, replayed into evidence. */
export interface ReportedBrokerCall {
  operationRef: string;
  /** read | write | ... */
  effect?: string;
  status?: "completed" | "accepted" | "failed";
  clientRequestId?: string;
  contractHash?: string;
  definitionVersionId?: string;
  adapterKind?: string;
  durationMs?: number;
  requestDigest?: string;
  resultDigest?: string;
  errorCategory?: string;
  budgetDelta?: Record<string, unknown>;
  /** Durable output reference, e.g. { kind: 'artifact', ref }. */
  durableRef?: { kind: string; ref: string } | null;
}

/** Structured run() return the tracer module emits (behind the result marker). */
export interface HeadlessDigestResult {
  ok?: boolean;
  digest?: unknown;
  /** Produced report Artifact id (from the platform Artifact op). */
  artifactId?: string | null;
  brokerCalls?: ReportedBrokerCall[];
  errorClass?: string;
  errorMessage?: string;
}

export interface CapabilityHeadlessEvent {
  routineId: string;
  input?: unknown;
  triggerSource?: string;
  triggerId?: string | null;
  /**
   * Explicit principal spec resolved at dispatch. When omitted, the routine
   * row's execution_principal is used. NEVER inferred across modes.
   */
  executionPrincipal?: ExecutionPrincipalSpec | null;
  /**
   * Config fingerprint the dispatch expects the resolved manifest to match.
   * A mismatch fails the run closed before any session opens (R15).
   */
  expectedConfigFingerprint?: string | null;
}

export interface CapabilityHeadlessResult {
  status: "succeeded" | "failed" | "blocked" | "degraded";
  executionId?: string;
  readinessOutcome?: ReadinessOutcome;
  commitSha?: string | null;
  brokerSessionId?: string | null;
  artifactId?: string | null;
  remediation?: Remediation;
  errorClass?: string;
  errorMessage?: string;
}

type Db = ReturnType<typeof getDb>;

export interface CapabilityHeadlessOptions {
  interpreterId: string;
  bucket: string;
  database?: Db;
  now?: () => Date;
  /** DynamoDB session store + table for the minted broker session. */
  sessionStore: DynamoPort;
  sessionTableName: string;
  /** Broker endpoint identity (else env). */
  brokerAudience?: string;
  brokerEndpoint?: string;
  brokerApiId?: string;
  region?: string;
  /**
   * Loads the exact validated SHA's module code (S3 read-through cache). In
   * production routine-exec-git supplies a closure over its loadModuleCode.
   */
  loadModuleCode: (sha: string) => Promise<string>;
  /** Sandbox runner; defaults to invokePythonTask. */
  pythonTask?: (
    input: PythonTaskInput,
    options: { interpreterId: string; bucket: string; envAllowlist?: string[] },
  ) => Promise<PythonTaskResult>;
  /** Deterministic ids for tests. */
  sessionId?: string;
  brokerSessionRowId?: string;
}

/** Result marker the sandbox prints before its JSON return value. */
export const HEADLESS_RESULT_MARKER = "__THINKWORK_CAPABILITY_RESULT__";

const DEFAULT_SESSION_TTL_SECONDS = SESSION_MAX_TTL_SECONDS;
const EXECUTION_TIMEOUT_SECONDS = 300;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function executeCapabilityHeadlessRoutine(
  event: CapabilityHeadlessEvent,
  options: CapabilityHeadlessOptions,
): Promise<CapabilityHeadlessResult> {
  const db = options.database ?? getDb();
  const now = options.now ?? (() => new Date());

  const [routine] = await db
    .select()
    .from(routines)
    .where(eq(routines.id, event.routineId))
    .limit(1);
  if (!routine) {
    return { status: "failed", errorClass: "infra_routine_not_found" };
  }

  const principal =
    event.executionPrincipal ??
    (routine.execution_principal as ExecutionPrincipalSpec | null) ??
    null;

  // Never infer or fall back across principal modes: a capability-headless run
  // is defined by an explicit 'service' principal. Anything else is not this
  // executor's job (the caller keeps the routine on the user-run-as path).
  if (!principal || principal.mode !== "service") {
    return {
      status: "failed",
      errorClass: "infra_not_service_principal",
      errorMessage:
        "capability-headless execution requires an explicit service principal",
    };
  }
  if (!principal.servicePrincipalId) {
    return {
      status: "failed",
      errorClass: "infra_no_service_principal_id",
      errorMessage: "service principal mode requires servicePrincipalId",
    };
  }

  const executionPrincipalSnapshot = {
    mode: "service" as const,
    servicePrincipalId: principal.servicePrincipalId,
  };

  // ---- Preflight: resolve exactly what would run, fail closed on drift -----
  const decision = await preflightReadiness(db, {
    routine,
    principal,
    expectedConfigFingerprint: event.expectedConfigFingerprint ?? null,
  });

  // Blocked → record a terminal run + remediation and open NO session (AE2/AE8).
  if (decision.outcome === "blocked") {
    return await recordBlockedRun(db, {
      routine,
      event,
      now,
      executionPrincipal: {
        ...executionPrincipalSnapshot,
        bindingId: decision.bindingId,
      },
      decision,
    });
  }

  // ---- Create the running ledger row (stamp the full pre-session evidence) --
  const executionId = randomUUID();
  await db.insert(routineExecutions).values({
    id: executionId,
    tenant_id: routine.tenant_id,
    routine_id: routine.id,
    trigger_id: event.triggerId ?? null,
    trigger_source: event.triggerSource ?? "automation",
    input_json: event.input ?? null,
    status: "running",
    started_at: now(),
    commit_sha: decision.execSha,
    validated_sha: routine.validated_sha,
    cache_served: false,
    execution_principal: {
      ...executionPrincipalSnapshot,
      bindingId: decision.bindingId,
    },
    capability_dependencies_json: decision.dependencies,
    config_fingerprint: decision.configFingerprint,
    readiness_outcome: decision.outcome,
    remediation_json: decision.remediation ?? null,
  });

  // ---- Mint a fresh broker session (durable evidence + Dynamo state) --------
  const brokerSessionRowId = options.brokerSessionRowId ?? randomUUID();
  let mint: MintResult | null = null;
  try {
    mint = await mintBrokerSession({
      tenantId: routine.tenant_id,
      contextFingerprint: decision.configFingerprint,
      principal: { mode: "service", subjectId: principal.servicePrincipalId },
      grantSnapshot: { dependencies: decision.dependencies },
      operations: buildOperationsMap(decision.dependencies),
      budgets: {},
      brokerSessionRowId,
      routineExecutionId: executionId,
      store: options.sessionStore,
      tableName: options.sessionTableName,
      audience: options.brokerAudience ?? getBrokerAudience(),
      brokerEndpoint: options.brokerEndpoint ?? getBrokerVpceEndpoint(),
      brokerApiId: options.brokerApiId ?? getBrokerApiId(),
      region: options.region,
      ttlSeconds: DEFAULT_SESSION_TTL_SECONDS,
      now: () => now().getTime(),
      sessionId: options.sessionId,
    });
  } catch (err) {
    // A session that could not be minted is an infra failure — no provider work
    // happened, so the run is blocked, not failed-with-effects.
    await terminalUpdate(db, executionId, {
      status: "blocked",
      finished_at: now(),
      readiness_outcome: "blocked",
      error_code: "broker_session_mint_failed",
      error_message: (err as Error).message,
      remediation_json: {
        kind: "broker_unavailable",
        detail: (err as Error).message,
        servicePrincipalId: principal.servicePrincipalId,
      },
    });
    return {
      status: "blocked",
      executionId,
      readinessOutcome: "blocked",
      errorClass: "broker_session_mint_failed",
      errorMessage: (err as Error).message,
    };
  }

  // Durable broker-session evidence row + link it onto the run.
  await db.insert(capabilityBrokerSessions).values({
    id: brokerSessionRowId,
    tenant_id: routine.tenant_id,
    session_id: mint.sessionId,
    audience: mint.audience,
    context_fingerprint: decision.configFingerprint,
    principal_mode: "service",
    service_principal_id: principal.servicePrincipalId,
    grant_snapshot_json: { dependencies: decision.dependencies },
    budgets_json: {},
    routine_execution_id: executionId,
    status: "active",
    expires_at: new Date(mint.expiresAt),
  });
  await db
    .update(routineExecutions)
    .set({ broker_session_id: brokerSessionRowId })
    .where(eq(routineExecutions.id, executionId));

  // ---- Run the exact cached SHA in the capability-private sandbox -----------
  let closed = false;
  const finallyCloseSession = async (status: "closed" | "cancelled") => {
    if (closed) return;
    closed = true;
    try {
      await closeSession(
        options.sessionStore,
        options.sessionTableName,
        mint!.sessionId,
        now().getTime(),
      );
    } catch (closeErr) {
      console.warn(
        `[capability-headless] closeSession failed for ${mint!.sessionId}: ${(closeErr as Error).message}`,
      );
    }
    await db
      .update(capabilityBrokerSessions)
      .set({ status, closed_at: now() })
      .where(eq(capabilityBrokerSessions.id, brokerSessionRowId));
  };

  try {
    const moduleCode = await options.loadModuleCode(decision.execSha!);
    const runner = options.pythonTask ?? invokePythonTask;
    const task = await runner(
      {
        tenantId: routine.tenant_id,
        executionId,
        nodeId: "digest",
        language: "python",
        code: buildHeadlessRunnerCode(moduleCode),
        input: buildTracerInput(routine, event, decision),
        // ONLY the declared credential bindings — the broker resolves provider
        // credentials, so this sandbox carries none of them; the session
        // bootstrap is the sole capability the sandbox holds.
        credentialBindings: [],
        capabilityPrivateSession: {
          interpreterId: options.interpreterId,
          bootstrap: mint.bootstrap,
        },
        timeoutSeconds: EXECUTION_TIMEOUT_SECONDS,
      },
      {
        interpreterId: options.interpreterId,
        bucket: options.bucket,
        envAllowlist: [],
      },
    );

    const parsed = extractHeadlessResult(task);
    const succeeded =
      task.exitCode === 0 && !task.errorClass && parsed?.ok !== false;

    // Replay the sandbox's declared broker calls into append-only evidence
    // (linked to the minted session + this run). When the live broker evidence
    // writer lands (U8) this becomes the reconciliation point, not a second
    // source of truth.
    const brokerCallByOp = await recordBrokerCallEvidence(db, {
      tenantId: routine.tenant_id,
      brokerSessionRowId,
      executionId,
      calls: parsed?.brokerCalls ?? [],
      now,
    });

    const artifactId = parsed?.artifactId ?? null;
    // One step event for the digest, linking the produced Artifact + the
    // Artifact-writing broker call.
    await db.insert(routineStepEvents).values({
      tenant_id: routine.tenant_id,
      execution_id: executionId,
      node_id: "digest",
      recipe_type: "python",
      status: succeeded ? "succeeded" : "failed",
      started_at: now(),
      finished_at: now(),
      output_json: succeeded ? (parsed?.digest ?? null) : null,
      error_json: succeeded
        ? null
        : {
            errorClass:
              task.errorClass ?? parsed?.errorClass ?? "code_run_failed",
            errorMessage: task.errorMessage ?? parsed?.errorMessage ?? null,
          },
      stdout_s3_uri: task.stdoutS3Uri,
      stdout_preview: task.stdoutPreview,
      truncated: task.truncated,
      broker_call_id: artifactId
        ? (brokerCallByOp.artifactCallId ?? null)
        : null,
      artifact_id: artifactId,
    });

    await finallyCloseSession("closed");

    await terminalUpdate(db, executionId, {
      status: succeeded
        ? decision.outcome === "degraded"
          ? "degraded"
          : "succeeded"
        : "failed",
      finished_at: now(),
      output_json: succeeded ? (parsed?.digest ?? null) : null,
      error_code: succeeded
        ? null
        : (task.errorClass ?? parsed?.errorClass ?? "code_run_failed"),
      error_message: succeeded
        ? null
        : (task.errorMessage ?? parsed?.errorMessage ?? null),
    });

    return {
      status: succeeded
        ? decision.outcome === "degraded"
          ? "degraded"
          : "succeeded"
        : "failed",
      executionId,
      readinessOutcome: decision.outcome,
      commitSha: decision.execSha,
      brokerSessionId: brokerSessionRowId,
      artifactId,
      ...(decision.outcome === "degraded" && decision.remediation
        ? { remediation: decision.remediation }
        : {}),
      ...(succeeded
        ? {}
        : {
            errorClass:
              task.errorClass ?? parsed?.errorClass ?? "code_run_failed",
            errorMessage:
              task.errorMessage ?? parsed?.errorMessage ?? undefined,
          }),
    };
  } catch (err) {
    // Any thrown error (broker timeout mid-run, module load failure, cancel)
    // still closes/cancels the session and records an explicit terminal state.
    await finallyCloseSession("cancelled");
    const message = (err as Error).message ?? "unknown";
    const errorClass =
      (err as { errorClass?: string }).errorClass ?? "infra_execution";
    await terminalUpdate(db, executionId, {
      status: "failed",
      finished_at: now(),
      error_code: errorClass,
      error_message: message,
    });
    return {
      status: "failed",
      executionId,
      readinessOutcome: decision.outcome,
      commitSha: decision.execSha,
      brokerSessionId: brokerSessionRowId,
      errorClass,
      errorMessage: message,
    };
  }
}

// ---------------------------------------------------------------------------
// Preflight readiness (fail closed — NO provider work on a mismatch)
// ---------------------------------------------------------------------------

export async function preflightReadiness(
  db: Db,
  args: {
    routine: {
      id: string;
      tenant_id: string;
      validated_sha: string | null;
      capability_dependencies: unknown;
    };
    principal: ExecutionPrincipalSpec;
    expectedConfigFingerprint: string | null;
  },
): Promise<PreflightDecision> {
  const dependencies = normalizeDependencies(
    args.routine.capability_dependencies,
  );
  const configFingerprint = canonicalSha256Hex(
    dependencies.map((d) => ({
      twcap: d.twcap,
      contractHash: d.contractHash,
      definitionVersionId: d.definitionVersionId,
    })),
  );

  const blocked = (r: Remediation): PreflightDecision => ({
    outcome: "blocked",
    execSha: null,
    configFingerprint,
    dependencies,
    bindingId: r.bindingId ?? null,
    remediation: r,
  });

  if (dependencies.length === 0) {
    return blocked({
      kind: "no_dependencies",
      detail:
        "routine has no pinned capability dependencies — nothing to authorize",
      servicePrincipalId: args.principal.servicePrincipalId ?? null,
    });
  }

  // Stale approval: a capability run executes the exact validated SHA. No
  // validated SHA means no approved code to run.
  if (!args.routine.validated_sha) {
    return blocked({
      kind: "no_validated_sha",
      detail:
        "routine has no validated SHA — a green fixture gate must promote code before a governed run",
      servicePrincipalId: args.principal.servicePrincipalId ?? null,
    });
  }

  // Config fingerprint drift (R15): the dispatch's expected fingerprint must
  // match the fingerprint recomputed over the resolved dependency manifest.
  if (
    args.expectedConfigFingerprint &&
    args.expectedConfigFingerprint !== configFingerprint
  ) {
    return blocked({
      kind: "config_fingerprint_mismatch",
      detail: `config fingerprint drift: expected ${args.expectedConfigFingerprint.slice(0, 16)}…, resolved ${configFingerprint.slice(0, 16)}…`,
      servicePrincipalId: args.principal.servicePrincipalId ?? null,
    });
  }

  // Service principal must exist + be active.
  const [servicePrincipal] = await db
    .select()
    .from(tenantServicePrincipals)
    .where(eq(tenantServicePrincipals.id, args.principal.servicePrincipalId!))
    .limit(1);
  if (
    !servicePrincipal ||
    servicePrincipal.tenant_id !== args.routine.tenant_id
  ) {
    return blocked({
      kind: "binding_missing",
      detail: "service principal not found for this tenant",
      servicePrincipalId: args.principal.servicePrincipalId ?? null,
    });
  }
  if (servicePrincipal.status !== "active") {
    return blocked({
      kind: "service_principal_revoked",
      detail: "service principal is revoked",
      servicePrincipalId: args.principal.servicePrincipalId ?? null,
    });
  }

  // Per-dependency: the admitted contract must still match the pinned hash
  // (contract drift), and the EXACT service binding must be ready.
  let degraded = false;
  let degradedRemediation: Remediation | undefined;
  let resolvedBindingId: string | null = null;

  for (const dep of dependencies) {
    const [version] = await db
      .select()
      .from(capabilityDefinitionVersions)
      .where(eq(capabilityDefinitionVersions.id, dep.definitionVersionId))
      .limit(1);
    if (!version || version.lifecycle !== "admitted") {
      return blocked({
        kind: "stale_approval",
        detail: `dependency ${dep.twcap} is not backed by an admitted definition version`,
        servicePrincipalId: args.principal.servicePrincipalId,
        definitionVersionId: dep.definitionVersionId,
      });
    }
    const hashes = (version.contract_hashes_json ?? {}) as Record<
      string,
      unknown
    >;
    const opId = dep.operationId ?? operationIdFromTwcap(dep.twcap);
    const currentHash = opId ? hashes[opId] : undefined;
    if (!currentHash || currentHash !== dep.contractHash) {
      return blocked({
        kind: "contract_drift",
        detail: `contract drift on ${dep.twcap}: pinned hash no longer matches the admitted contract`,
        servicePrincipalId: args.principal.servicePrincipalId,
        definitionVersionId: dep.definitionVersionId,
      });
    }

    // The EXACT service binding for this version + principal. A ready
    // requester binding is NOT a substitute — no fallback across modes (R6).
    const [binding] = await db
      .select()
      .from(capabilityCredentialBindings)
      .where(
        and(
          eq(
            capabilityCredentialBindings.definition_version_id,
            dep.definitionVersionId,
          ),
          eq(capabilityCredentialBindings.principal_mode, "service"),
          eq(
            capabilityCredentialBindings.service_principal_id,
            args.principal.servicePrincipalId!,
          ),
        ),
      )
      .limit(1);

    if (!binding) {
      return blocked({
        kind: "binding_missing",
        detail: `no service binding for ${dep.twcap} — the requester binding (if any) is never a fallback`,
        servicePrincipalId: args.principal.servicePrincipalId,
        definitionVersionId: dep.definitionVersionId,
      });
    }
    resolvedBindingId = binding.id;
    if (binding.readiness === "revoked") {
      return blocked({
        kind: "binding_revoked",
        detail: `service binding for ${dep.twcap} is revoked`,
        servicePrincipalId: args.principal.servicePrincipalId,
        bindingId: binding.id,
        definitionVersionId: dep.definitionVersionId,
      });
    }
    if (binding.readiness === "ready") {
      continue;
    }
    if (binding.readiness === "degraded") {
      // Degraded (not revoked): the run may proceed but is attributably
      // reduced — surfaced as a degraded outcome + remediation.
      degraded = true;
      degradedRemediation = {
        kind: "binding_degraded",
        detail: `service binding for ${dep.twcap} is degraded`,
        servicePrincipalId: args.principal.servicePrincipalId,
        bindingId: binding.id,
        definitionVersionId: dep.definitionVersionId,
      };
      continue;
    }
    // pending_setup | verifying → not usable → blocked.
    return blocked({
      kind: "binding_not_ready",
      detail: `service binding for ${dep.twcap} is ${binding.readiness}`,
      servicePrincipalId: args.principal.servicePrincipalId,
      bindingId: binding.id,
      definitionVersionId: dep.definitionVersionId,
    });
  }

  return {
    outcome: degraded ? "degraded" : "ready",
    execSha: args.routine.validated_sha,
    configFingerprint,
    dependencies,
    bindingId: resolvedBindingId,
    ...(degraded && degradedRemediation
      ? { remediation: degradedRemediation }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Blocked-run recording (terminal + operator remediation, NO session)
// ---------------------------------------------------------------------------

async function recordBlockedRun(
  db: Db,
  args: {
    routine: {
      id: string;
      tenant_id: string;
      name?: string | null;
      validated_sha: string | null;
    };
    event: CapabilityHeadlessEvent;
    now: () => Date;
    executionPrincipal: Record<string, unknown>;
    decision: PreflightDecision;
  },
): Promise<CapabilityHeadlessResult> {
  const { routine, event, now, decision } = args;
  const executionId = randomUUID();
  await db.insert(routineExecutions).values({
    id: executionId,
    tenant_id: routine.tenant_id,
    routine_id: routine.id,
    trigger_id: event.triggerId ?? null,
    trigger_source: event.triggerSource ?? "automation",
    input_json: event.input ?? null,
    status: "blocked",
    started_at: now(),
    finished_at: now(),
    commit_sha: null,
    validated_sha: routine.validated_sha,
    execution_principal: args.executionPrincipal,
    capability_dependencies_json: decision.dependencies,
    config_fingerprint: decision.configFingerprint,
    readiness_outcome: "blocked",
    remediation_json: decision.remediation ?? null,
    error_code: decision.remediation?.kind ?? "blocked",
    error_message:
      decision.remediation?.detail ?? "capability readiness blocked",
  });

  // Operator-readable remediation item. One pending item per routine so a
  // failing schedule cannot spam the inbox.
  const [pending] = await db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.tenant_id, routine.tenant_id),
        eq(inboxItems.type, "capability_run_blocked"),
        eq(inboxItems.entity_id, routine.id),
        eq(inboxItems.status, "pending"),
      ),
    )
    .limit(1);
  if (!pending) {
    await db.insert(inboxItems).values({
      tenant_id: routine.tenant_id,
      type: "capability_run_blocked",
      status: "pending",
      title: `Governed run blocked: ${routine.name ?? routine.id}`,
      description: `${decision.remediation?.kind ?? "blocked"}: ${decision.remediation?.detail ?? ""}`,
      entity_type: "routine",
      entity_id: routine.id,
      config: {
        executionId,
        remediation: decision.remediation ?? null,
      },
    });
  }

  return {
    status: "blocked",
    executionId,
    readinessOutcome: "blocked",
    remediation: decision.remediation,
    errorClass: decision.remediation?.kind ?? "blocked",
    errorMessage: decision.remediation?.detail,
  };
}

// ---------------------------------------------------------------------------
// Broker-call evidence
// ---------------------------------------------------------------------------

async function recordBrokerCallEvidence(
  db: Db,
  args: {
    tenantId: string;
    brokerSessionRowId: string;
    executionId: string;
    calls: ReportedBrokerCall[];
    now: () => Date;
  },
): Promise<{ artifactCallId: string | null }> {
  let artifactCallId: string | null = null;
  let sequence = 0;
  for (const call of args.calls) {
    const id = randomUUID();
    const status = call.status ?? "completed";
    try {
      await db.insert(capabilityBrokerCalls).values({
        id,
        tenant_id: args.tenantId,
        broker_session_id: args.brokerSessionRowId,
        client_request_id:
          call.clientRequestId ?? `${args.executionId}:${sequence}`,
        sequence,
        operation_ref: call.operationRef,
        contract_hash: call.contractHash ?? null,
        definition_version_id: call.definitionVersionId ?? null,
        status,
        request_digest: call.requestDigest ?? null,
        result_digest: call.resultDigest ?? null,
        error_category: call.errorCategory ?? null,
        effect: call.effect ?? "read",
        budget_delta_json: call.budgetDelta ?? {},
        adapter_kind: call.adapterKind ?? null,
        duration_ms: call.durationMs ?? null,
        durable_ref_json: call.durableRef ?? null,
        routine_execution_id: args.executionId,
        authorized_at: args.now(),
        finalized_at: args.now(),
      });
      if (call.durableRef?.kind === "artifact") {
        artifactCallId = id;
      }
    } catch (err) {
      console.warn(
        `[capability-headless] failed to record broker-call evidence: ${(err as Error).message}`,
      );
    }
    sequence += 1;
  }
  return { artifactCallId };
}

// ---------------------------------------------------------------------------
// Broker session mint (mirrors the api trusted opener — lambda cannot import
// @thinkwork/api, so the minimal mint lives here over lambda-local primitives)
// ---------------------------------------------------------------------------

interface MintResult {
  sessionId: string;
  audience: string;
  publicKey: string;
  expiresAt: string;
  bootstrap: SessionBootstrap;
}

export async function mintBrokerSession(input: {
  tenantId: string;
  contextFingerprint: string;
  principal: { mode: PrincipalMode; subjectId?: string };
  grantSnapshot?: Record<string, unknown>;
  budgets?: Record<string, unknown>;
  brokerSessionRowId: string;
  routineExecutionId?: string | null;
  store: DynamoPort;
  tableName: string;
  audience: string;
  brokerEndpoint: string;
  brokerApiId: string;
  region?: string;
  invokePath?: string;
  /** operationId → canonical twcap map the sandbox SDK expands friendly ids with. */
  operations?: Record<string, string>;
  ttlSeconds?: number;
  now?: () => number;
  sessionId?: string;
}): Promise<MintResult> {
  const nowMs = (input.now ?? Date.now)();
  if (!input.audience) throw new Error("broker-session: audience unavailable");
  if (!input.brokerEndpoint) {
    throw new Error("broker-session: CAPABILITY_BROKER_VPCE_DNS unavailable");
  }
  if (!input.brokerApiId) {
    throw new Error("broker-session: CAPABILITY_BROKER_API_ID unavailable");
  }

  const ttlSeconds = Math.min(
    Math.max(1, Math.floor(input.ttlSeconds ?? SESSION_MAX_TTL_SECONDS)),
    SESSION_MAX_TTL_SECONDS,
  );
  const sessionId = input.sessionId ?? randomUUID();
  const expiresEpochSeconds = Math.floor(nowMs / 1000) + ttlSeconds;
  const expiresAt = new Date(expiresEpochSeconds * 1000).toISOString();

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyB64 = publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");
  const privateKeyB64 = privateKey
    .export({ format: "der", type: "pkcs8" })
    .toString("base64");

  const created = await createSession(input.store, input.tableName, {
    sessionId,
    tenantId: input.tenantId,
    audience: input.audience,
    publicKey: publicKeyB64,
    contextFingerprint: input.contextFingerprint,
    principalMode: input.principal.mode,
    subjectId: input.principal.subjectId ?? "",
    grantSnapshot: input.grantSnapshot ?? {},
    budgets: input.budgets ?? {},
    brokerSessionRowId: input.brokerSessionRowId,
    routineExecutionId: input.routineExecutionId ?? null,
    threadTurnId: null,
    createdEpochMs: nowMs,
    expiresEpochSeconds,
  });
  if (!created.ok) {
    throw new Error(`broker-session: session id ${sessionId} already exists`);
  }

  const bootstrap: SessionBootstrap = {
    sessionId,
    audience: input.audience,
    brokerEndpoint: input.brokerEndpoint,
    brokerApiId: input.brokerApiId,
    privateKey: privateKeyB64,
    nextSequence: 0,
    expiresAt,
    invokePath: input.invokePath ?? getBrokerInvokePath(),
    ...(input.region ? { region: input.region } : {}),
    ...(input.operations && Object.keys(input.operations).length
      ? { operations: input.operations }
      : {}),
  };
  return {
    sessionId,
    audience: input.audience,
    publicKey: publicKeyB64,
    expiresAt,
    bootstrap,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getBrokerVpceEndpoint(): string {
  return process.env.CAPABILITY_BROKER_VPCE_DNS ?? "";
}
/**
 * Path the sandbox POSTs to. The broker REST API's proxy resource is
 * `/{stage}/{proxy+}`, so the path MUST include the stage (a bare `/` is
 * unmatched → API Gateway 403). The `invoke` segment is arbitrary — the broker
 * Lambda proxies every path — but keeps the stage prefix explicit.
 */
export function getBrokerInvokePath(): string {
  const stage = process.env.STAGE ?? "";
  return stage ? `/${stage}/invoke` : "/invoke";
}
export function getBrokerApiId(): string {
  return process.env.CAPABILITY_BROKER_API_ID ?? "";
}
export function getBrokerAudience(): string {
  return process.env.CAPABILITY_BROKER_AUDIENCE ?? "";
}

function normalizeDependencies(raw: unknown): CapabilityDependency[] {
  if (!Array.isArray(raw)) return [];
  const out: CapabilityDependency[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (
      typeof e.twcap === "string" &&
      typeof e.contractHash === "string" &&
      typeof e.definitionVersionId === "string"
    ) {
      out.push({
        twcap: e.twcap,
        contractHash: e.contractHash,
        definitionVersionId: e.definitionVersionId,
        operationId:
          typeof e.operationId === "string" ? e.operationId : undefined,
      });
    }
  }
  return out;
}

/** Extract the operation id from the `#<operationId>` fragment of a twcap ref. */
function operationIdFromTwcap(twcap: string): string | null {
  const hash = twcap.lastIndexOf("#");
  return hash === -1 ? null : twcap.slice(hash + 1);
}

/**
 * Parse the compact dependency reference the Routine manifest pins
 * (`twcap:<ns>/<class>/<slug>@<version>#<operationId>`) into its segments. The
 * compact form is the STORED shape; the broker wire form is the canonical
 * `twcap://…` (`formatTwcapRef`). Returns null on any shape it does not fully
 * recognize — the caller then omits that operation from the binding map rather
 * than emitting a half-parsed reference.
 */
function parseCompactTwcap(twcap: string): {
  namespace: string;
  class: string;
  slug: string;
  version: string;
  operationId: string;
} | null {
  if (!twcap.startsWith("twcap:")) return null;
  const body = twcap.slice("twcap:".length);
  const hashAt = body.lastIndexOf("#");
  if (hashAt === -1) return null;
  const operationId = body.slice(hashAt + 1);
  const beforeHash = body.slice(0, hashAt);
  const atAt = beforeHash.lastIndexOf("@");
  if (atAt === -1) return null;
  const version = beforeHash.slice(atAt + 1);
  const path = beforeHash.slice(0, atAt);
  const segments = path.split("/").filter((s) => s.length > 0);
  if (segments.length !== 3) return null;
  const [namespace, cls, slug] = segments;
  if (!namespace || !cls || !slug || !version || !operationId) return null;
  return { namespace, class: cls, slug, version, operationId };
}

/**
 * Build the session `operations` binding map: friendly `operationId` → canonical
 * `twcap://…` reference the broker's `parseTwcapRef` accepts. Derived from the
 * exact pinned dependency manifest so the reference the sandbox signs is the
 * SAME identity every parity surface reproduces. Malformed entries are dropped
 * (fail closed) — an operation absent from the map is passed through verbatim by
 * the SDK and the broker fails it as a malformed reference.
 */
export function buildOperationsMap(
  dependencies: CapabilityDependency[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const dep of dependencies) {
    const parsed = parseCompactTwcap(dep.twcap);
    const operationId =
      dep.operationId ?? parsed?.operationId ?? operationIdFromTwcap(dep.twcap);
    if (!parsed || !operationId) continue;
    try {
      map[operationId] = formatTwcapRef({
        namespace: parsed.namespace,
        class: parsed.class,
        slug: parsed.slug,
        version: parsed.version,
        operationId,
        contractHash: dep.contractHash,
      });
    } catch {
      // formatTwcapRef rejected a segment — drop this operation from the map.
      continue;
    }
  }
  return map;
}

/** Input surfaced to the tracer as `input`: repo/as-of metadata + caller input. */
function buildTracerInput(
  routine: { id: string; tenant_id: string },
  event: CapabilityHeadlessEvent,
  decision: PreflightDecision,
): Record<string, unknown> {
  const base =
    event.input &&
    typeof event.input === "object" &&
    !Array.isArray(event.input)
      ? (event.input as Record<string, unknown>)
      : {};
  return {
    ...base,
    _routineId: routine.id,
    _dependencies: decision.dependencies.map((d) => d.twcap),
    _asOf: base._asOf ?? new Date().toISOString(),
  };
}

/** Wrap the tracer module so `run(input)` executes; its dict return comes back
 * behind a marker line (same contract as routine-exec-git). */
function buildHeadlessRunnerCode(moduleCode: string): string {
  return (
    moduleCode +
    "\n\n" +
    "if True:\n" +
    "    import json as __tw_json\n" +
    "    __tw_result = run(input)\n" +
    `    print(${JSON.stringify(HEADLESS_RESULT_MARKER)} + __tw_json.dumps(__tw_result, default=str))\n`
  );
}

export function extractHeadlessResult(
  task: PythonTaskResult,
): HeadlessDigestResult | null {
  const idx = task.stdoutPreview.lastIndexOf(HEADLESS_RESULT_MARKER);
  if (idx === -1) return null;
  const line = task.stdoutPreview
    .slice(idx + HEADLESS_RESULT_MARKER.length)
    .split("\n")[0];
  try {
    return JSON.parse(line) as HeadlessDigestResult;
  } catch {
    return null;
  }
}

async function terminalUpdate(
  db: Db,
  executionId: string,
  set: Record<string, unknown>,
): Promise<void> {
  await db
    .update(routineExecutions)
    .set(set)
    .where(
      and(
        eq(routineExecutions.id, executionId),
        eq(routineExecutions.status, "running"),
      ),
    );
}

/** Resolve the capability-private interpreter id for a tenant (production
 * wiring). Exported so routine-exec-git can build the executor options. */
export async function resolveCapabilityPrivateInterpreterId(
  db: Db,
  tenantId: string,
): Promise<string | null> {
  const [row] = await db
    .select({
      id: tenants.sandbox_interpreter_capability_private_id,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row?.id ?? null;
}

/** Read the most-recent green code-cache row for a routine (evidence helper). */
export async function latestValidatedCacheRow(
  db: Db,
  routineId: string,
): Promise<{ sha: string; capability_dependencies: unknown } | null> {
  const [row] = await db
    .select({
      sha: routineCodeCache.sha,
      capability_dependencies: routineCodeCache.capability_dependencies,
    })
    .from(routineCodeCache)
    .where(
      and(
        eq(routineCodeCache.routine_id, routineId),
        eq(routineCodeCache.fixture_status, "green"),
      ),
    )
    .orderBy(desc(routineCodeCache.validated_at))
    .limit(1);
  return row ?? null;
}
