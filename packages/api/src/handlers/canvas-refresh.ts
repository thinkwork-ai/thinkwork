/**
 * canvas-refresh — headless Living Artifacts data-refresh Lambda (THINK-145 U6).
 *
 * Invoked (RequestResponse) by `refreshCanvasData` (user + agent triggers) and
 * by `job-trigger`'s `canvas_refresh` branch (scheduled trigger, U7). For each
 * data binding of a canvas artifact it re-executes the saved MCP tool call
 * under the binding's TENANT-scoped identity, compares the result-shape hash,
 * and — on a match — writes the fresh payload into the artifact head's bound
 * data slice under the KTD6 concurrency guard, flipping the binding quality
 * (R6/R7/R8/R9). The PRIMARY effect is the head + binding write (KTD7); a
 * STATE_SNAPSHOT thread event is published ONLY when the caller supplies a live
 * `threadTurnId` (a canvas checked out into a running thread) — a scheduled
 * refresh of a thread-less canvas has no turn to append to and must not try
 * (`thread_turn_events.run_id` is a NOT NULL FK).
 *
 * NO model / Bedrock call happens anywhere in this path — a headless refresh
 * consumes no agent turn and no tokens.
 *
 * IAM reality (reported, not silently assumed): this handler runs on the shared
 * `aws_iam_role.lambda` role, which already grants `secretsmanager:GetSecretValue`
 * on `thinkwork/*` (all tenants) — there is no per-Lambda role in the for_each
 * pool. Per-invocation TENANT scoping is therefore enforced IN CODE: bindings,
 * the artifact, and the MCP server rows are all filtered by the `tenantId` in
 * the event, and the only secret fetched is the resolved server row's own
 * `auth_config.secretRef` for that tenant. See the terraform comment on the
 * `canvas-refresh` handler entry.
 */

import { getApiAuthSecret } from "@thinkwork/runtime-config";
import {
  threadJsonRenderStateSnapshotPayload,
  validateThreadJsonRenderPart,
} from "@thinkwork/thread-json-render";
import {
  and,
  db,
  eq,
  sql,
  artifacts,
  artifactDataBindings,
} from "../graphql/utils.js";
import {
  resolveTenantMcpServerTarget,
  type ResolveTenantMcpServerTargetResult,
} from "../lib/mcp-configs.js";
import { mcpCallTool, type McpServerTarget } from "../lib/mcp-client-call.js";
import {
  loadCanvasHeadContent,
  type CanvasArtifactRow,
} from "../lib/artifacts/canvas-lifecycle.js";
import {
  artifactContentKey,
  writeArtifactPayloadToS3,
} from "../lib/artifacts/payload-storage.js";
import {
  refreshCanvasBindings,
  type CanvasRefreshBinding,
  type CanvasRefreshBindingResult,
  type CanvasRefreshDeps,
  type CanvasRefreshTrigger,
} from "../lib/artifacts/canvas-refresh-core.js";
import {
  appendThreadTurnEvent,
  drizzleThreadTurnEventStore,
} from "../lib/thread-turn-events.js";
import { notifyThreadTurnStep } from "../graphql/notify.js";

const LOG_PREFIX = "[canvas-refresh]";

const CANVAS_CONTENT_TYPE = "application/json; charset=utf-8" as const;

/** Bounded retries for the KTD6 head-write concurrency guard. */
const HEAD_WRITE_MAX_ATTEMPTS = 3;

export interface CanvasRefreshEvent {
  tenantId: string;
  artifactId: string;
  /** Optional: refresh only the bindings of this part. */
  partId?: string;
  trigger: CanvasRefreshTrigger;
  /**
   * Optional live thread turn to publish a STATE_SNAPSHOT into — present only
   * when the canvas is checked out into a running thread (agent-triggered). A
   * scheduled / user refresh of a thread-less canvas omits this.
   */
  threadTurnId?: string;
  threadId?: string;
  /** Bearer auth for callers that don't invoke via IAM (defense in depth). */
  authSecret?: string;
}

export interface CanvasRefreshResultPayload {
  ok: boolean;
  artifactId: string;
  error?: string;
  bindings: CanvasRefreshBindingResult[];
}

/**
 * Build the KTD6-guarded head data-slice writer. The head document is the
 * persisted json-render part; the fresh payload is stored ADDITIVELY under a
 * top-level `boundData` map keyed by element id, so the validated `data.spec`
 * (last-good render) is never touched and the renderer/validator posture is
 * unchanged (a data-refresh writes ONLY its part's data slice — KTD6). The
 * guard re-reads the head + the binding's CURRENT shape hash each attempt and
 * aborts to `"stale"` when a concurrent spec re-emit changed either — the stale
 * slice is never applied over a re-emitted spec (R7).
 */
function makeApplyHeadData(
  tenantId: string,
  artifactRow: CanvasArtifactRow,
): CanvasRefreshDeps["applyHeadData"] {
  return async (input) => {
    for (let attempt = 0; attempt < HEAD_WRITE_MAX_ATTEMPTS; attempt++) {
      // Re-read the head row's concurrency token + storage location.
      const [current] = await db
        .select({
          id: artifacts.id,
          tenant_id: artifacts.tenant_id,
          content: artifacts.content,
          s3_key: artifacts.s3_key,
          head_write_seq: artifacts.head_write_seq,
        })
        .from(artifacts)
        .where(
          and(eq(artifacts.id, artifactRow.id), eq(artifacts.tenant_id, tenantId)),
        );
      if (!current) return "stale";
      const observedSeq = current.head_write_seq ?? 0;

      // Re-validate the binding's CURRENT shape against the shape the data was
      // fetched under. A re-emit that re-captured the binding with a new shape
      // invalidates this slice — abort (KTD6 / R7).
      const [bindingNow] = await db
        .select({ result_shape_hash: artifactDataBindings.result_shape_hash })
        .from(artifactDataBindings)
        .where(eq(artifactDataBindings.id, input.bindingId));
      if (
        !bindingNow ||
        bindingNow.result_shape_hash !== input.fetchedShapeHash
      ) {
        return "stale";
      }

      // Load + mutate the head document's additive bound-data slice.
      const headRow: CanvasArtifactRow = {
        ...artifactRow,
        content: current.content,
        s3_key: current.s3_key,
      };
      const raw = await loadCanvasHeadContent(headRow);
      let headDoc: Record<string, unknown>;
      try {
        headDoc = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        return "stale";
      }
      const boundData =
        headDoc.boundData &&
        typeof headDoc.boundData === "object" &&
        !Array.isArray(headDoc.boundData)
          ? (headDoc.boundData as Record<string, unknown>)
          : {};
      boundData[input.elementId] = {
        payload: input.payload,
        fetchedAt: input.fetchedAt.toISOString(),
        shapeHash: input.fetchedShapeHash,
      };
      headDoc.boundData = boundData;

      // Claim the write by advancing head_write_seq under the observed token.
      // A concurrent spec change (save / pin / check-in also bumps this token)
      // makes this match zero rows → retry with a fresh read.
      const claimed = await db
        .update(artifacts)
        .set({
          head_write_seq: sql`${artifacts.head_write_seq} + 1`,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(artifacts.id, artifactRow.id),
            eq(artifacts.tenant_id, tenantId),
            eq(artifacts.head_write_seq, observedSeq),
          ),
        )
        .returning({ id: artifacts.id });
      if (claimed.length === 0) continue; // lost the race — re-read + retry

      // Guard claimed: write the head payload (overwrite-in-place head key).
      const key =
        current.s3_key ??
        artifactContentKey({ tenantId, artifactId: artifactRow.id });
      await writeArtifactPayloadToS3({
        tenantId,
        key,
        body: JSON.stringify(headDoc),
        contentType: CANVAS_CONTENT_TYPE,
      });
      if (!current.s3_key) {
        await db
          .update(artifacts)
          .set({ s3_key: key, content: null })
          .where(eq(artifacts.id, artifactRow.id));
      }
      return "applied";
    }
    return "stale";
  };
}

/** Persist a binding's post-refresh quality + freshness timestamps. */
const writeBindingQuality: CanvasRefreshDeps["writeBindingQuality"] = async (
  input,
) => {
  await db
    .update(artifactDataBindings)
    .set({
      quality: input.quality,
      updated_at: input.now,
      ...(input.markFetched ? { last_fetched_at: input.now } : {}),
      ...(input.markGood ? { last_good_at: input.now } : {}),
    })
    .where(eq(artifactDataBindings.id, input.bindingId));
};

/** Resolve a tenant MCP server for headless execution (Secrets-Manager-backed). */
async function resolveServerTarget(
  tenantId: string,
  serverName: string,
): Promise<ResolveTenantMcpServerTargetResult> {
  return resolveTenantMcpServerTarget({ tenantId, serverName, logPrefix: LOG_PREFIX });
}

/**
 * Publish a STATE_SNAPSHOT of the (refreshed) head part into a live thread turn
 * so checked-out clients converge. Best-effort — a publish fault never fails the
 * refresh (the head + binding writes already landed). No-op when the head can't
 * be parsed to a valid part.
 */
async function publishHeadSnapshot(input: {
  tenantId: string;
  threadId: string;
  threadTurnId: string;
  artifactRow: CanvasArtifactRow;
  agentId: string | null;
}): Promise<void> {
  const raw = await loadCanvasHeadContent(input.artifactRow);
  if (!raw) return;
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return;
  }
  // The head document may carry the additive `boundData` sidecar; the snapshot
  // event carries only the validated {type,id,data} part.
  const validation = validateThreadJsonRenderPart(doc);
  if (!validation.ok) return;
  const payload = threadJsonRenderStateSnapshotPayload(validation.part);

  const store = drizzleThreadTurnEventStore();
  const row = await appendThreadTurnEvent(store, {
    tenantId: input.tenantId,
    runId: input.threadTurnId,
    agentId: input.agentId,
    eventType: "state_snapshot",
    message: "",
    payload,
    stream: "step",
  });
  await notifyThreadTurnStep({
    runId: input.threadTurnId,
    threadId: input.threadId,
    tenantId: input.tenantId,
    seq: row.seq,
    eventType: "state_snapshot",
    stream: "step",
    level: null,
    color: null,
    message: null,
    payload: payload as unknown as Record<string, unknown>,
    createdAt: new Date().toISOString(),
  });
}

export async function handler(
  event: CanvasRefreshEvent,
): Promise<CanvasRefreshResultPayload> {
  const { tenantId, artifactId, partId, threadTurnId, threadId } = event;

  if (!tenantId || !artifactId) {
    return {
      ok: false,
      artifactId: artifactId ?? "",
      error: "tenantId and artifactId are required",
      bindings: [],
    };
  }

  // Optional bearer check for non-IAM callers (defense in depth; IAM is the
  // primary boundary for RequestResponse invokers).
  if (event.authSecret) {
    let expected: string | null = null;
    try {
      expected = getApiAuthSecret();
    } catch {
      expected = null;
    }
    if (expected && event.authSecret !== expected) {
      return {
        ok: false,
        artifactId,
        error: "Invalid auth secret",
        bindings: [],
      };
    }
  }

  const [artifactRow] = await db
    .select({
      id: artifacts.id,
      tenant_id: artifacts.tenant_id,
      type: artifacts.type,
      status: artifacts.status,
      content: artifacts.content,
      s3_key: artifacts.s3_key,
      head_version: artifacts.head_version,
      head_write_seq: artifacts.head_write_seq,
      thread_id: artifacts.thread_id,
      agent_id: artifacts.agent_id,
      metadata: artifacts.metadata,
    })
    .from(artifacts)
    .where(and(eq(artifacts.id, artifactId), eq(artifacts.tenant_id, tenantId)));

  if (!artifactRow) {
    return {
      ok: false,
      artifactId,
      error: "Canvas artifact not found for tenant",
      bindings: [],
    };
  }

  const bindingRows = await db
    .select({
      id: artifactDataBindings.id,
      part_id: artifactDataBindings.part_id,
      element_id: artifactDataBindings.element_id,
      server_name: artifactDataBindings.server_name,
      mcp_server_ref: artifactDataBindings.mcp_server_ref,
      tool_name: artifactDataBindings.tool_name,
      frozen_args: artifactDataBindings.frozen_args,
      result_shape_hash: artifactDataBindings.result_shape_hash,
      auth_context: artifactDataBindings.auth_context,
      quality: artifactDataBindings.quality,
    })
    .from(artifactDataBindings)
    .where(
      partId
        ? and(
            eq(artifactDataBindings.tenant_id, tenantId),
            eq(artifactDataBindings.artifact_id, artifactId),
            eq(artifactDataBindings.part_id, partId),
          )
        : and(
            eq(artifactDataBindings.tenant_id, tenantId),
            eq(artifactDataBindings.artifact_id, artifactId),
          ),
    );

  const bindings: CanvasRefreshBinding[] = bindingRows.map((row) => ({
    id: row.id,
    partId: row.part_id,
    elementId: row.element_id,
    serverName: row.server_name,
    serverRef: row.mcp_server_ref,
    toolName: row.tool_name,
    frozenArgs:
      (row.frozen_args as Record<string, unknown> | null) ?? {},
    resultShapeHash: row.result_shape_hash,
    authContext:
      row.auth_context === "per_user_oauth" ? "per_user_oauth" : "tenant_mcp",
    quality: row.quality,
  }));

  const deps: CanvasRefreshDeps = {
    resolveServerTarget: ({ serverName }) =>
      resolveServerTarget(tenantId, serverName),
    callTool: async ({ target, toolName, args }) => {
      const result = await mcpCallTool(
        target as McpServerTarget,
        toolName,
        args,
      );
      return { isError: result.isError, raw: result.raw };
    },
    applyHeadData: makeApplyHeadData(tenantId, artifactRow as CanvasArtifactRow),
    writeBindingQuality,
    now: () => new Date(),
  };

  const results = await refreshCanvasBindings(bindings, deps);

  // Publish a live snapshot ONLY when a running thread turn was named AND at
  // least one binding actually updated the head. A thread-less canvas (no
  // threadTurnId) writes head + binding and publishes nothing (KTD7).
  const anyApplied = results.some((r) => r.outcome === "refreshed");
  if (anyApplied && threadTurnId && threadId) {
    await publishHeadSnapshot({
      tenantId,
      threadId,
      threadTurnId,
      artifactRow: artifactRow as CanvasArtifactRow,
      agentId: (artifactRow.agent_id as string | null) ?? null,
    }).catch((err) => {
      console.error(
        `${LOG_PREFIX} state_snapshot publish failed (best-effort):`,
        err,
      );
    });
  }

  return { ok: true, artifactId, bindings: results };
}
