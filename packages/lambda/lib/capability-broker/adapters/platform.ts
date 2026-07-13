/**
 * ThinkWork platform capability adapter (THINK-280 U5 — R5, R15, R19).
 *
 * Calls a small, explicit allowlist of first-party platform operations. It does
 * NOT go through GraphQL and does NOT reuse the user-facing auth resolvers: it
 * performs service-principal attribution in its OWN narrow insert so a service
 * call never impersonates a user and never widens `resolveCallerFromAuth`.
 *
 * The only operation wired for the GitHub tracer is Artifact creation
 * (`operationId: "artifact.create"`), which returns a DURABLE, attributable
 * reference. Attribution recorded on the row: tenant, actor/service principal,
 * the operation reference, the source Routine execution + thread turn, and the
 * broker evidence (call) reference.
 *
 * A service principal writes `created_by_user_id = NULL` — the platform-wide
 * "NULL = system, not a user" convention (see artifacts createArtifact) — so
 * the artifact is unambiguously system-attributed and cannot be mistaken for a
 * user's canvas. When a `requester`/`agent_owner` principal is used the
 * resolved subject user id is stamped instead.
 */

import type {
  CanonicalJson,
  OperationContract,
} from "@thinkwork/capability-contracts";

import type {
  AdapterDispatchContext,
  AdapterDispatchOutcome,
  CapabilityAdapter,
} from "./registry.js";
import { validateAgainstSchema } from "./schema-validate.js";

export const PLATFORM_ARTIFACT_CREATE_OPERATION_ID = "artifact.create";

/** Attribution + payload for one platform artifact insert. */
export interface PlatformArtifactInsert {
  tenantId: string;
  /** NULL for a service principal (system), else the resolved subject user id. */
  createdByUserId: string | null;
  /** twcap operation reference that produced the artifact. */
  operationRef: string;
  /** Source Routine execution + thread turn (provenance). */
  routineExecutionId: string | null;
  threadTurnId: string | null;
  /** Broker evidence (call) row id. */
  brokerCallId: string;
  title: string;
  type: string;
  summary: string | null;
  content: string | null;
}

export interface PlatformArtifactWriter {
  create(input: PlatformArtifactInsert): Promise<{ id: string }>;
}

export interface PlatformAdapterOptions {
  artifactWriter: PlatformArtifactWriter;
}

export function createPlatformAdapter(
  opts: PlatformAdapterOptions,
): CapabilityAdapter {
  return {
    kind: "platform",
    async dispatch(
      ctx: AdapterDispatchContext,
    ): Promise<AdapterDispatchOutcome> {
      if (ctx.contract.operationId !== PLATFORM_ARTIFACT_CREATE_OPERATION_ID) {
        // Only explicitly registered platform operations dispatch. There is no
        // generic GraphQL/database escape hatch.
        return {
          status: "failed",
          category: "unavailable_adapter",
          message: "platform operation is not registered",
          retryable: false,
        };
      }
      return createArtifactOperation(ctx, opts.artifactWriter);
    },
  };
}

async function createArtifactOperation(
  ctx: AdapterDispatchContext,
  writer: PlatformArtifactWriter,
): Promise<AdapterDispatchOutcome> {
  const violations = validateAgainstSchema(ctx.contract.inputSchema, ctx.input);
  if (violations.length > 0) {
    return {
      status: "failed",
      category: "invalid_request",
      message: "input failed schema validation",
      retryable: false,
    };
  }
  const input = (ctx.input ?? {}) as Record<string, unknown>;
  const title = typeof input.title === "string" ? input.title : null;
  if (!title) {
    return {
      status: "failed",
      category: "invalid_request",
      message: "artifact title is required",
      retryable: false,
    };
  }

  // Service-principal attribution: a service call is system-attributed
  // (created_by_user_id NULL). Only a user-bearing principal stamps a user id.
  const createdByUserId =
    ctx.principal.mode === "service" ? null : ctx.principal.subjectId;

  let inserted: { id: string };
  try {
    inserted = await writer.create({
      tenantId: ctx.tenantId,
      createdByUserId,
      operationRef: ctx.operationRef,
      routineExecutionId: ctx.provenance.routineExecutionId,
      threadTurnId: ctx.provenance.threadTurnId,
      brokerCallId: ctx.provenance.brokerCallId,
      title,
      type: typeof input.type === "string" ? input.type : "document",
      summary: typeof input.summary === "string" ? input.summary : null,
      content: typeof input.content === "string" ? input.content : null,
    });
  } catch {
    return {
      status: "failed",
      category: "adapter_error",
      message: "platform artifact insert failed",
      retryable: false,
    };
  }

  // Durable, attributable identity — never an inline body.
  return {
    status: "completed",
    durable: { kind: "artifact", ref: inserted.id },
  };
}

/**
 * Contract-shape guard for the tracer Artifact-create operation, exported so the
 * platform-seed reference contract and tests share one definition of the
 * expected input schema without duplicating it.
 */
export function platformArtifactCreateInputSchema(): CanonicalJson {
  return {
    type: "object",
    required: ["title"],
    additionalProperties: false,
    properties: {
      title: { type: "string", maxLength: 512 },
      type: { type: "string", maxLength: 64 },
      summary: { type: "string", maxLength: 4096 },
      content: { type: "string", maxLength: 65536 },
    },
  };
}

/** Narrow view of an operation contract this adapter accepts (for callers/tests). */
export function isPlatformArtifactCreateOperation(
  contract: OperationContract,
): boolean {
  return contract.operationId === PLATFORM_ARTIFACT_CREATE_OPERATION_ID;
}
