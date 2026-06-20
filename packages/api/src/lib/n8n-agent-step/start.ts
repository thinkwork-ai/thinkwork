import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  agentWakeupRequests,
  agents,
  messages,
  n8nAgentStepRuns,
  spaces,
} from "@thinkwork/database-pg/schema";
import { ensureThreadForWork } from "../thread-helpers.js";
import { db as defaultDb } from "../db.js";
import {
  createSecretsManagerPluginSecrets,
  type PluginSecretsClient,
} from "../plugins/secrets.js";
import type { N8nAgentStepAuthContext } from "./auth.js";
import type { ParsedN8nAgentStepStartPayload } from "./payload.js";
import {
  buildN8nAgentStepIdempotencyKey,
  normalizeN8nAgentStepTimeout,
  previewN8nAgentStepValue,
  sanitizeN8nAgentStepMetadata,
} from "./types.js";

type DbLike = typeof defaultDb;
type EnsureThreadForWork = typeof ensureThreadForWork;
type RunRow = typeof n8nAgentStepRuns.$inferSelect;

export class N8nAgentStepStartError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "N8nAgentStepStartError";
  }
}

export interface StartN8nAgentStepRunDeps {
  db?: DbLike;
  ensureThread?: EnsureThreadForWork;
  secrets?: PluginSecretsClient;
  now?: () => Date;
  stage?: string;
}

export interface StartN8nAgentStepRunResult {
  runId: string;
  status: string;
  replayed: boolean;
  wakeupRequestId: string | null;
  threadId: string | null;
  threadIdentifier: string | null;
  threadNumber: number | null;
  openingMessageId: string | null;
  expiresAt: string;
}

export async function startN8nAgentStepRun(
  auth: N8nAgentStepAuthContext,
  payload: ParsedN8nAgentStepStartPayload,
  deps: StartN8nAgentStepRunDeps = {},
): Promise<StartN8nAgentStepRunResult> {
  const db = deps.db ?? defaultDb;
  const now = deps.now?.() ?? new Date();
  const timeout = normalizeN8nAgentStepTimeout({
    timeoutSeconds: payload.timeoutSeconds,
    now,
  });
  const idempotencyKey = buildN8nAgentStepIdempotencyKey({
    tenantId: auth.tenantId,
    n8n: {
      workflowId: payload.workflowId,
      workflowName: payload.workflowName,
      executionId: payload.executionId,
      stepId: payload.stepId,
    },
    correlationId: payload.correlationId,
  });

  const existing = await findRunByIdempotencyKey({
    db,
    tenantId: auth.tenantId,
    idempotencyKey,
  });
  if (existing) return replayResult(existing);

  await assertAgentAndSpaceExist({
    db,
    tenantId: auth.tenantId,
    agentId: payload.agentId,
    spaceId: payload.spaceId,
  });

  const resumeSecretRef = payload.resumeUrl
    ? resumeUrlSecretRef({
        stage: deps.stage ?? process.env.THINKWORK_STAGE ?? process.env.STAGE,
        tenantSlug: auth.tenantSlug,
        idempotencyKey,
      })
    : null;
  const [insertedRun] = await db
    .insert(n8nAgentStepRuns)
    .values({
      tenant_id: auth.tenantId,
      plugin_install_id: auth.pluginInstallId,
      managed_application_id: auth.managedApplicationId,
      space_id: payload.spaceId,
      agent_id: payload.agentId,
      status: "accepted",
      resume_status: payload.resumeUrl ? "pending" : "not_ready",
      workflow_id: payload.workflowId,
      workflow_name: payload.workflowName,
      execution_id: payload.executionId,
      step_id: payload.stepId,
      correlation_id: payload.correlationId,
      request_id: payload.requestId,
      idempotency_key: idempotencyKey,
      instructions_preview: previewN8nAgentStepValue(payload.instructions),
      input_preview: previewN8nAgentStepValue(payload.input),
      request_metadata: requestMetadata({ auth, payload }),
      resume_url_secret_ref: resumeSecretRef,
      resume_url_host: payload.resumeUrl?.host ?? null,
      resume_url_path: payload.resumeUrl?.path ?? null,
      timeout_seconds: timeout.timeoutSeconds,
      expires_at: timeout.expiresAt,
      accepted_at: now,
      created_at: now,
      updated_at: now,
    })
    .onConflictDoNothing({
      target: [n8nAgentStepRuns.tenant_id, n8nAgentStepRuns.idempotency_key],
    })
    .returning();

  const run =
    insertedRun ??
    (await findRunByIdempotencyKey({
      db,
      tenantId: auth.tenantId,
      idempotencyKey,
    }));
  if (!run) {
    throw new N8nAgentStepStartError("Bridge run could not be created", 500);
  }
  if (!insertedRun) return replayResult(run);

  if (payload.resumeUrl && resumeSecretRef) {
    const secrets = deps.secrets ?? createSecretsManagerPluginSecrets();
    await secrets.putSecret(
      resumeSecretRef,
      JSON.stringify({
        resumeUrl: payload.resumeUrl.href,
        tenantId: auth.tenantId,
        workflowId: payload.workflowId,
        executionId: payload.executionId,
        stepId: payload.stepId,
        correlationId: payload.correlationId,
      }),
    );
  }

  const ensureThread = deps.ensureThread ?? ensureThreadForWork;
  const threadTitle = threadTitleForPayload(payload);
  const thread = await ensureThread({
    tenantId: auth.tenantId,
    agentId: payload.agentId,
    spaceId: payload.spaceId,
    title: threadTitle,
    channel: "webhook",
  });
  const openingContent = openingMessageForPayload(payload);
  const [openingMessage] = await db
    .insert(messages)
    .values({
      tenant_id: auth.tenantId,
      thread_id: thread.threadId,
      role: "system",
      content: openingContent,
      sender_type: "system",
      metadata: {
        source: "n8n_agent_step",
        runId: run.id,
        workflowId: payload.workflowId,
        workflowName: payload.workflowName,
        executionId: payload.executionId,
        stepId: payload.stepId,
        correlationId: payload.correlationId,
        requestId: payload.requestId,
        hasResumeUrl: Boolean(payload.resumeUrl),
      },
      created_at: now,
    })
    .returning({ id: messages.id });
  if (!openingMessage?.id) {
    throw new N8nAgentStepStartError(
      "Bridge opening message could not be created",
      500,
    );
  }

  const [wakeup] = await db
    .insert(agentWakeupRequests)
    .values({
      tenant_id: auth.tenantId,
      agent_id: payload.agentId,
      source: "webhook",
      trigger_detail: `n8n-agent-step:${run.id}`,
      reason: `n8n workflow step: ${payload.workflowName ?? payload.workflowId}`,
      payload: {
        n8nAgentStepRunId: run.id,
        threadId: thread.threadId,
        threadIdentifier: thread.identifier,
        threadNumber: thread.number,
        openingMessageId: openingMessage.id,
        openingMessageAlreadyPersisted: true,
        openingMessageContent: openingContent,
        message: payload.instructions,
        workflowId: payload.workflowId,
        workflowName: payload.workflowName,
        executionId: payload.executionId,
        stepId: payload.stepId,
        correlationId: payload.correlationId,
        requestId: payload.requestId,
        webhookPayload: {
          input: payload.input,
          metadata: sanitizeN8nAgentStepMetadata(payload.metadata),
        },
        spaceId: payload.spaceId,
      },
      requested_by_actor_type: "system",
      idempotency_key: idempotencyKey,
      requested_at: now,
      created_at: now,
    })
    .returning({ id: agentWakeupRequests.id });
  if (!wakeup?.id) {
    throw new N8nAgentStepStartError("Agent wakeup could not be queued", 500);
  }

  const [updatedRun] = await db
    .update(n8nAgentStepRuns)
    .set({
      status: "waiting",
      thread_id: thread.threadId,
      opening_message_id: openingMessage.id,
      updated_at: now,
    })
    .where(eq(n8nAgentStepRuns.id, run.id))
    .returning();

  return {
    runId: updatedRun?.id ?? run.id,
    status: updatedRun?.status ?? "waiting",
    replayed: false,
    wakeupRequestId: wakeup.id,
    threadId: thread.threadId,
    threadIdentifier: thread.identifier,
    threadNumber: thread.number,
    openingMessageId: openingMessage.id,
    expiresAt: timeout.expiresAt.toISOString(),
  };
}

async function assertAgentAndSpaceExist(input: {
  db: DbLike;
  tenantId: string;
  agentId: string;
  spaceId: string;
}) {
  const [agent] = await input.db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(eq(agents.tenant_id, input.tenantId), eq(agents.id, input.agentId)),
    )
    .limit(1);
  if (!agent) {
    throw new N8nAgentStepStartError("agentId was not found");
  }
  const [space] = await input.db
    .select({ id: spaces.id })
    .from(spaces)
    .where(
      and(
        eq(spaces.tenant_id, input.tenantId),
        eq(spaces.id, input.spaceId),
        eq(spaces.status, "active"),
      ),
    )
    .limit(1);
  if (!space) {
    throw new N8nAgentStepStartError("spaceId was not found or is not active");
  }
}

async function findRunByIdempotencyKey(input: {
  db: DbLike;
  tenantId: string;
  idempotencyKey: string;
}): Promise<RunRow | null> {
  const [run] = await input.db
    .select()
    .from(n8nAgentStepRuns)
    .where(
      and(
        eq(n8nAgentStepRuns.tenant_id, input.tenantId),
        eq(n8nAgentStepRuns.idempotency_key, input.idempotencyKey),
      ),
    )
    .limit(1);
  return run ?? null;
}

function replayResult(run: RunRow): StartN8nAgentStepRunResult {
  return {
    runId: run.id,
    status: run.status,
    replayed: true,
    wakeupRequestId: null,
    threadId: run.thread_id,
    threadIdentifier: null,
    threadNumber: null,
    openingMessageId: run.opening_message_id,
    expiresAt: run.expires_at.toISOString(),
  };
}

function requestMetadata(input: {
  auth: N8nAgentStepAuthContext;
  payload: ParsedN8nAgentStepStartPayload;
}): Record<string, unknown> {
  return {
    source: "n8n_agent_step",
    tenantSlug: input.auth.tenantSlug,
    workflowId: input.payload.workflowId,
    workflowName: input.payload.workflowName,
    executionId: input.payload.executionId,
    stepId: input.payload.stepId,
    correlationId: input.payload.correlationId,
    requestId: input.payload.requestId,
    hasResumeUrl: Boolean(input.payload.resumeUrl),
    metadata: sanitizeN8nAgentStepMetadata(input.payload.metadata),
  };
}

function resumeUrlSecretRef(input: {
  stage: string | undefined;
  tenantSlug: string;
  idempotencyKey: string;
}): string {
  const stage = input.stage?.trim() || "unknown";
  const digest = createHash("sha256")
    .update(input.idempotencyKey)
    .digest("hex")
    .slice(0, 32);
  return `thinkwork/${stage}/n8n-agent-step-runs/${input.tenantSlug}/${digest}/resume-url`;
}

function threadTitleForPayload(
  payload: ParsedN8nAgentStepStartPayload,
): string {
  const workflow = payload.workflowName ?? payload.workflowId;
  return `n8n ${workflow}: ${payload.stepId}`;
}

function openingMessageForPayload(
  payload: ParsedN8nAgentStepStartPayload,
): string {
  const lines = [
    "n8n requested a ThinkWork agent step.",
    `Workflow: ${payload.workflowName ?? payload.workflowId}`,
    `Execution: ${payload.executionId}`,
    `Step: ${payload.stepId}`,
    `Correlation: ${payload.correlationId}`,
    "",
    "Instructions:",
    previewN8nAgentStepValue(payload.instructions),
  ];
  const inputPreview = previewN8nAgentStepValue(payload.input);
  if (inputPreview && inputPreview !== "null") {
    lines.push("", "Input preview:", inputPreview);
  }
  return lines.join("\n");
}
