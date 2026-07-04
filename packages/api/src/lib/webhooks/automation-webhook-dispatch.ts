/**
 * Inbound webhook → Automation dispatch (THINK-137 U6, R6 + R7).
 *
 * A delivery for a `target_type = 'automation'` webhook row (bound to a loop by
 * `agent_loop_id`) resolves the loop + current version and dispatches through
 * the SHARED agent-loops dispatcher — the same path the schedule and manual
 * triggers use. This module owns only the webhook-specific glue:
 *
 *   - derived idempotency key (header `x-idempotency-key`, else a deterministic
 *     hash of webhook id + raw body — real senders never send the header);
 *   - payload mapping (R7): raw body → routine/workflow run input, or fenced
 *     into an agent_thread turn's instructions (never interpolated elsewhere);
 *   - HTTP-outcome mapping so the sender retries the right failures.
 *
 * Like the manual GraphQL trigger, routine-bearing automations DEFER their
 * continuation to job-trigger (this Lambda has a 30s budget; routine-exec-git
 * can take up to 360s), so the webhooks handler never blocks on a routine.
 * agent_thread dispatch (a wakeup enqueue) runs inline.
 *
 * Dependencies that touch AWS / the DB are injected via `deps` so the logic is
 * unit-testable with an in-memory ledger; production callers omit `deps` and
 * get the real wiring.
 */

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  dispatchAgentLoop,
  fenceWebhookPayload,
  resolveDispatchableVersion,
  type AgentLoopDispatchInput,
  type AgentLoopDispatchLedger,
  type AgentLoopDispatchResult,
  type AgentLoopWebhookDelivery,
  type DispatchableAgentLoop,
  type DispatchableAgentLoopVersion,
} from "@thinkwork/agent-loops-core";
import {
  createDbAgentLoopLedger,
  ensureThreadForWork,
  loadActiveSpaceId,
  loadAgentDefaultSpaceId,
} from "@thinkwork/database-pg";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import {
  agentLoopVersions,
  agentLoops,
  agentLoopRuns,
  db,
  webhooks,
} from "../../graphql/utils.js";
import { json } from "../response.js";

type WebhookRow = typeof webhooks.$inferSelect;

/** Fields the HTTP handler needs to update on its delivery-audit accumulator. */
export interface AutomationDeliveryOutcome {
  resolution_status: "ok" | "ignored" | "rate_limited" | "error";
  status_code: number;
  thread_id?: string;
  thread_created?: boolean;
  error_message?: string;
  is_replay?: boolean;
}

/** Result: the HTTP response plus the delivery-audit patch to apply. */
export interface AutomationDispatchResult {
  response: APIGatewayProxyStructuredResultV2;
  delivery: AutomationDeliveryOutcome;
}

/** Continuation event handed to job-trigger for routine-bearing automations. */
export interface AutomationContinueDispatchPayload {
  tenantId: string;
  agentLoopId: string;
  runId: string;
  iterationId: string;
  triggerFamily: "webhook";
  triggerSource: string;
  runAsUserId: string | null;
  threadId: string | null;
  spaceId: string | null;
  webhookDelivery: AgentLoopWebhookDelivery;
  routineInputOverride: Record<string, unknown> | null;
}

interface ResolvedAutomationContext {
  loop: DispatchableAgentLoop;
  runAsUserId: string | null;
  version: DispatchableAgentLoopVersion | null;
  hasRoutineActions: boolean;
  targetKind: string | null;
  spaceId: string | null;
  threadId: string | null;
}

type LoadContextResult =
  | { ok: true; context: ResolvedAutomationContext }
  | { ok: false; message: string };

export interface AutomationWebhookDeps {
  loadContext(webhook: WebhookRow): Promise<LoadContextResult>;
  makeLedger(): AgentLoopDispatchLedger;
  dispatch: typeof dispatchAgentLoop;
  loadRunErrorCode(tenantId: string, runId: string): Promise<string | null>;
  invokeContinue(payload: AutomationContinueDispatchPayload): Promise<void>;
  now: Date;
}

// Guard skips (R11) are transient from the sender's view — a retry after the
// cap frees up should succeed — so they map to 429 (Retry-After). Every other
// skip (disabled/paused/version-missing/run_as_tenant_mismatch) is permanent
// for THIS delivery; a retry won't fix it, so we 2xx and record the drop.
const GUARD_SKIP_CODES = new Set(["max_concurrent_runs", "monthly_cost_cap"]);

/**
 * Derive the dispatch idempotency key (THINK-137 U6, load-bearing). Prefers the
 * `x-idempotency-key` header when a sender supplies one; otherwise a
 * deterministic sha256 of (webhook id + raw body) so an at-least-once resend of
 * the SAME payload reuses the existing run. Real senders (GitHub/Stripe/Slack)
 * never send the header, so the derived path is the common case.
 */
export function deriveAutomationWebhookIdempotencyKey(
  webhookId: string,
  rawBody: string,
  header: string | undefined,
): string {
  const trimmed = header?.trim();
  if (trimmed) return trimmed;
  const hash = createHash("sha256")
    .update(`${webhookId}\n${rawBody}`)
    .digest("hex");
  return `webhook:${webhookId}:sha256:${hash}`;
}

export async function dispatchAutomationWebhook(args: {
  webhook: WebhookRow;
  parsedBody: Record<string, unknown>;
  rawBody: string;
  headerIdempotencyKey: string | undefined;
  deps?: AutomationWebhookDeps;
}): Promise<AutomationDispatchResult> {
  const { webhook, parsedBody, rawBody, headerIdempotencyKey } = args;
  const deps = args.deps ?? defaultDeps();

  const idempotencyKey = deriveAutomationWebhookIdempotencyKey(
    webhook.id,
    rawBody,
    headerIdempotencyKey,
  );

  const loaded = await deps.loadContext(webhook);
  if (!loaded.ok) {
    return {
      response: json({ error: loaded.message }, 500),
      delivery: {
        resolution_status: "error",
        status_code: 500,
        error_message: loaded.message,
      },
    };
  }
  const ctx = loaded.context;

  const triggerSource = `webhook:${webhook.id}`;
  const webhookDelivery: AgentLoopWebhookDelivery = {
    source: triggerSource,
    eventId: idempotencyKey,
    // Pointer to the retained body — the webhook_deliveries row stores it by
    // its sha256. We never carry the raw body here (PII).
    payloadPointer: args.rawBody
      ? `sha256:${createHash("sha256").update(rawBody).digest("hex")}`
      : null,
  };

  // R7 payload mapping. agent_thread → fenced instruction context; everything
  // else (routine/workflow) → the run input override. Mutually exclusive.
  const isAgentThread = ctx.targetKind === "agent_thread";
  const appendedInstructions = isAgentThread
    ? fenceWebhookPayload(JSON.stringify(parsedBody))
    : null;
  const routineInputOverride = isAgentThread ? null : parsedBody;

  const dispatchInput: AgentLoopDispatchInput = {
    tenantId: webhook.tenant_id,
    loop: ctx.loop,
    version: ctx.version,
    trigger: {
      family: "webhook",
      source: triggerSource,
      // The webhook itself is the trigger actor (systemic). The run-as identity
      // (R5) is DISTINCT and drives context injection.
      actorType: "system",
      actorId: null,
      runAsUserId: ctx.runAsUserId,
      threadId: ctx.threadId,
      spaceId: ctx.spaceId,
      idempotencyKey,
      correlationId: idempotencyKey,
      inputSummary: {
        webhookId: webhook.id,
        webhookName: webhook.name,
        source: triggerSource,
      },
      webhookDelivery,
      appendedInstructions,
      routineInputOverride,
    },
    now: deps.now,
  };

  const result = await deps.dispatch(dispatchInput, deps.makeLedger(), {
    deferContinuation: ctx.hasRoutineActions,
  });

  if (result.status === "deferred") {
    await deps.invokeContinue({
      tenantId: webhook.tenant_id,
      agentLoopId: ctx.loop.id,
      runId: result.runId,
      iterationId: result.iterationId,
      triggerFamily: "webhook",
      triggerSource,
      runAsUserId: ctx.runAsUserId,
      threadId: ctx.threadId,
      spaceId: ctx.spaceId,
      webhookDelivery,
      routineInputOverride,
    });
  }

  return mapDispatchResult(result, {
    tenantId: webhook.tenant_id,
    threadId: ctx.threadId,
    loadRunErrorCode: deps.loadRunErrorCode,
  });
}

async function mapDispatchResult(
  result: AgentLoopDispatchResult,
  opts: {
    tenantId: string;
    threadId: string | null;
    loadRunErrorCode: AutomationWebhookDeps["loadRunErrorCode"];
  },
): Promise<AutomationDispatchResult> {
  switch (result.status) {
    case "reused":
      return {
        response: json({ ok: true, runId: result.runId, deduplicated: true }),
        delivery: {
          resolution_status: "ok",
          status_code: 200,
          is_replay: true,
        },
      };
    case "queued":
      return {
        response: json(
          { ok: true, runId: result.runId, wakeupId: result.wakeupId },
          201,
        ),
        delivery: {
          resolution_status: "ok",
          status_code: 201,
          thread_id: opts.threadId ?? undefined,
          thread_created: opts.threadId ? true : undefined,
        },
      };
    case "deferred":
      // Run + iteration exist; the routine continuation was handed to
      // job-trigger. 202 Accepted — work is in flight.
      return {
        response: json({ ok: true, runId: result.runId, deferred: true }, 202),
        delivery: { resolution_status: "ok", status_code: 202 },
      };
    case "completed_routine_only":
      return {
        response: json({ ok: true, runId: result.runId, completed: true }),
        delivery: { resolution_status: "ok", status_code: 200 },
      };
    case "skipped": {
      const code = await opts.loadRunErrorCode(opts.tenantId, result.runId);
      if (code && GUARD_SKIP_CODES.has(code)) {
        // Transient — sender should retry after the cap frees.
        return {
          response: {
            statusCode: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "60",
            },
            body: JSON.stringify({
              error: result.reason,
              runId: result.runId,
              code,
            }),
          },
          delivery: {
            resolution_status: "rate_limited",
            status_code: 429,
            error_message: result.reason,
          },
        };
      }
      // Permanent for this delivery (disabled/paused/version-missing/
      // run_as_tenant_mismatch) — record the drop, do NOT make the sender retry.
      return {
        response: json({
          ok: false,
          runId: result.runId,
          skipped: true,
          reason: result.reason,
        }),
        delivery: {
          resolution_status: "ignored",
          status_code: 200,
          error_message: result.reason,
        },
      };
    }
    case "failed":
      // Transient infra failure (e.g. wakeup enqueue) — 500 so the sender retries.
      return {
        response: json(
          { ok: false, runId: result.runId, error: result.error },
          500,
        ),
        delivery: {
          resolution_status: "error",
          status_code: 500,
          error_message: result.error,
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Default (production) dependency wiring
// ---------------------------------------------------------------------------

function defaultDeps(): AutomationWebhookDeps {
  return {
    now: new Date(),
    dispatch: dispatchAgentLoop,
    makeLedger: () => createDbAgentLoopLedger(db),
    loadContext: (webhook) => loadAutomationContext(webhook),
    loadRunErrorCode: async (tenantId, runId) => {
      const [row] = await db
        .select({ error_code: agentLoopRuns.error_code })
        .from(agentLoopRuns)
        .where(
          and(
            eq(agentLoopRuns.tenant_id, tenantId),
            eq(agentLoopRuns.id, runId),
          ),
        )
        .limit(1);
      return row?.error_code ?? null;
    },
    invokeContinue: (payload) => invokeAutomationContinueDispatch(payload),
  };
}

async function loadAutomationContext(
  webhook: WebhookRow,
): Promise<LoadContextResult> {
  if (!webhook.agent_loop_id) {
    return { ok: false, message: "Automation webhook missing agent_loop_id" };
  }
  const [loop] = await db
    .select({
      id: agentLoops.id,
      tenant_id: agentLoops.tenant_id,
      name: agentLoops.name,
      enabled: agentLoops.enabled,
      lifecycle_status: agentLoops.lifecycle_status,
      current_version_id: agentLoops.current_version_id,
      space_id: agentLoops.space_id,
      run_as_user_id: agentLoops.run_as_user_id,
    })
    .from(agentLoops)
    .where(
      and(
        eq(agentLoops.id, webhook.agent_loop_id),
        eq(agentLoops.tenant_id, webhook.tenant_id),
      ),
    )
    .limit(1);
  if (!loop) {
    return {
      ok: false,
      message: `Automation ${webhook.agent_loop_id} not found`,
    };
  }

  const versionRow = loop.current_version_id
    ? (
        await db
          .select({
            id: agentLoopVersions.id,
            version_status: agentLoopVersions.version_status,
            goal_spec: agentLoopVersions.goal_spec,
            worker_spec: agentLoopVersions.worker_spec,
            loop_policy: agentLoopVersions.loop_policy,
            routine_actions_spec: agentLoopVersions.routine_actions_spec,
            target_spec: agentLoopVersions.target_spec,
          })
          .from(agentLoopVersions)
          .where(eq(agentLoopVersions.id, loop.current_version_id))
          .limit(1)
      )[0]
    : null;
  const version = versionRow ? resolveDispatchableVersion(versionRow) : null;

  const targetKind = version?.targetKind ?? null;
  const hasRoutineActions =
    (version?.routineActionsSpec?.actions.length ?? 0) > 0;

  // Space is resolved loop-level only (headless semantics, U4): agent_thread
  // inherits the worker's default Space when unset; routine/workflow never.
  const workerId =
    version?.workerSpec?.type === "agent" ? version.workerSpec.id : null;
  const configuredSpaceId = loop.space_id
    ? await loadActiveSpaceId(db, loop.tenant_id, loop.space_id)
    : null;
  const spaceId =
    configuredSpaceId ??
    (targetKind === "agent_thread" && workerId
      ? await loadAgentDefaultSpaceId(db, loop.tenant_id, workerId)
      : null);

  // No Space ⇒ no thread. Only an active agent_thread automation with a
  // resolved Space + worker opens an execution Thread.
  const threadId =
    targetKind === "agent_thread" &&
    spaceId &&
    workerId &&
    loop.lifecycle_status === "active"
      ? (
          await ensureThreadForWork({
            tenantId: loop.tenant_id,
            agentId: workerId,
            spaceId,
            title: `Automation: ${loop.name}`,
            channel: "webhook",
          })
        ).threadId
      : null;

  return {
    ok: true,
    context: {
      loop: {
        id: loop.id,
        tenantId: loop.tenant_id,
        name: loop.name,
        enabled: loop.enabled,
        lifecycleStatus: loop.lifecycle_status,
      },
      runAsUserId: loop.run_as_user_id ?? null,
      version,
      hasRoutineActions,
      targetKind,
      spaceId,
      threadId,
    },
  };
}

/** Event-invoke job-trigger for the deferred routine continuation. The run row
 * already exists in `queued`; job-trigger marks it failed on continuation
 * error, so this async handoff still surfaces failures on the run ledger. */
async function invokeAutomationContinueDispatch(
  payload: AutomationContinueDispatchPayload,
): Promise<void> {
  const { LambdaClient, InvokeCommand } =
    await import("@aws-sdk/client-lambda");
  const lambda = new LambdaClient({});
  const stage = process.env.STAGE;
  const fnName =
    process.env.JOB_TRIGGER_FUNCTION_NAME ??
    (stage ? `thinkwork-${stage}-api-job-trigger` : null);
  if (!fnName) {
    throw new Error(
      "Cannot dispatch routine actions: JOB_TRIGGER_FUNCTION_NAME/STAGE not configured",
    );
  }
  const response = await lambda.send(
    new InvokeCommand({
      FunctionName: fnName,
      InvocationType: "Event",
      Payload: new TextEncoder().encode(
        JSON.stringify({
          triggerType: "agent_loop_continue_dispatch",
          triggerId: payload.runId,
          tenantId: payload.tenantId,
          agentLoopId: payload.agentLoopId,
          runId: payload.runId,
          iterationId: payload.iterationId,
          threadId: payload.threadId,
          spaceId: payload.spaceId ?? undefined,
          // Webhook provenance so the continuation dispatches with the right
          // trigger family, source, delivery attribution, and routine input.
          triggerFamily: payload.triggerFamily,
          triggerSource: payload.triggerSource,
          webhookDelivery: payload.webhookDelivery,
          routineInputOverride: payload.routineInputOverride,
        }),
      ),
    }),
  );
  if (typeof response.StatusCode === "number" && response.StatusCode >= 300) {
    throw new Error(
      `job-trigger continuation invoke returned ${response.StatusCode}`,
    );
  }
}
