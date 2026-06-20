import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  agentWakeupRequests,
  agents,
  messages,
  n8nAgentStepRuns,
  spaces,
  threads,
} from "@thinkwork/database-pg/schema";
import { ensureThreadForWork } from "../thread-helpers.js";
import { db as defaultDb } from "../db.js";
import {
  createSecretsManagerPluginSecrets,
  type PluginSecretsClient,
} from "../plugins/secrets.js";
import type { N8nAgentStepAuthContext } from "./auth.js";
import {
  assertN8nAgentStepResumeUrlPolicy,
  type ParsedN8nAgentStepStartPayload,
} from "./payload.js";
import {
  buildN8nAgentStepIdempotencyKey,
  normalizeN8nAgentStepTimeout,
  previewN8nAgentStepValue,
  sanitizeN8nAgentStepMetadata,
} from "./types.js";

type DbLike = typeof defaultDb;
type EnsureThreadForWork = typeof ensureThreadForWork;
type RunRow = typeof n8nAgentStepRuns.$inferSelect;
type WakeupRow = { id: string };
type ThreadRow = {
  threadId: string;
  identifier: string | null;
  number: number;
};

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
  assertN8nAgentStepResumeUrlPolicy(payload.resumeUrl, auth.n8nPublicUrl);
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
  if (existing) {
    assertResumeUrlMatchesExistingRun(existing, payload);
    const wakeup = await findWakeupByIdempotencyKey({
      db,
      tenantId: auth.tenantId,
      agentId: payload.agentId,
      idempotencyKey,
    });
    if (!shouldRecoverRunStart(existing, wakeup)) {
      return replayResult(existing, wakeup);
    }
    await assertAgentAndSpaceExist({
      db,
      tenantId: auth.tenantId,
      agentId: payload.agentId,
      spaceId: payload.spaceId,
    });
    return completeRunStart({
      db,
      run: existing,
      auth,
      payload,
      idempotencyKey,
      now,
      ensureThread: deps.ensureThread ?? ensureThreadForWork,
      secrets: deps.secrets,
      existingWakeup: wakeup,
    });
  }

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
  const existingWakeup = insertedRun
    ? null
    : await findWakeupByIdempotencyKey({
        db,
        tenantId: auth.tenantId,
        agentId: payload.agentId,
        idempotencyKey,
      });
  if (!insertedRun && !shouldRecoverRunStart(run, existingWakeup)) {
    return replayResult(run, existingWakeup);
  }

  return completeRunStart({
    db,
    run,
    auth,
    payload,
    idempotencyKey,
    now,
    ensureThread: deps.ensureThread ?? ensureThreadForWork,
    secrets: deps.secrets,
    existingWakeup,
  });
}

async function completeRunStart(input: {
  db: DbLike;
  run: RunRow;
  auth: N8nAgentStepAuthContext;
  payload: ParsedN8nAgentStepStartPayload;
  idempotencyKey: string;
  now: Date;
  ensureThread: EnsureThreadForWork;
  secrets: PluginSecretsClient | undefined;
  existingWakeup: WakeupRow | null;
}): Promise<StartN8nAgentStepRunResult> {
  const { db, run, auth, payload, idempotencyKey, now } = input;

  if (payload.resumeUrl && run.resume_url_secret_ref) {
    const secrets = input.secrets ?? createSecretsManagerPluginSecrets();
    await secrets.putSecret(
      run.resume_url_secret_ref,
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

  const thread = await ensureRunThread({
    db,
    run,
    auth,
    payload,
    now,
    ensureThread: input.ensureThread,
  });
  const openingContent = openingMessageForPayload(payload);
  const openingMessageId =
    run.opening_message_id ??
    (await createOpeningMessage({
      db,
      run,
      auth,
      payload,
      thread,
      openingContent,
      now,
    }));
  if (!run.opening_message_id) {
    await db
      .update(n8nAgentStepRuns)
      .set({
        opening_message_id: openingMessageId,
        updated_at: now,
      })
      .where(eq(n8nAgentStepRuns.id, run.id))
      .returning();
  }

  const wakeup =
    input.existingWakeup ??
    (await findWakeupByIdempotencyKey({
      db,
      tenantId: auth.tenantId,
      agentId: payload.agentId,
      idempotencyKey,
    })) ??
    (await createAgentWakeup({
      db,
      run,
      auth,
      payload,
      thread,
      openingMessageId,
      openingContent,
      idempotencyKey,
      now,
    }));

  const [updatedRun] = await db
    .update(n8nAgentStepRuns)
    .set({
      status: "waiting",
      thread_id: thread.threadId,
      opening_message_id: openingMessageId,
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
    openingMessageId,
    expiresAt: (updatedRun?.expires_at ?? run.expires_at).toISOString(),
  };
}

async function ensureRunThread(input: {
  db: DbLike;
  run: RunRow;
  auth: N8nAgentStepAuthContext;
  payload: ParsedN8nAgentStepStartPayload;
  now: Date;
  ensureThread: EnsureThreadForWork;
}): Promise<ThreadRow> {
  if (input.run.thread_id) {
    const [thread] = await input.db
      .select({
        threadId: threads.id,
        identifier: threads.identifier,
        number: threads.number,
      })
      .from(threads)
      .where(
        and(
          eq(threads.tenant_id, input.auth.tenantId),
          eq(threads.id, input.run.thread_id),
        ),
      )
      .limit(1);
    if (!thread) {
      throw new N8nAgentStepStartError(
        "Bridge thread could not be recovered",
        500,
      );
    }
    return thread;
  }

  const thread = await input.ensureThread({
    tenantId: input.auth.tenantId,
    agentId: input.payload.agentId,
    spaceId: input.payload.spaceId,
    title: threadTitleForPayload(input.payload),
    channel: "webhook",
  });
  await input.db
    .update(n8nAgentStepRuns)
    .set({
      thread_id: thread.threadId,
      updated_at: input.now,
    })
    .where(eq(n8nAgentStepRuns.id, input.run.id))
    .returning();
  return thread;
}

async function createOpeningMessage(input: {
  db: DbLike;
  run: RunRow;
  auth: N8nAgentStepAuthContext;
  payload: ParsedN8nAgentStepStartPayload;
  thread: ThreadRow;
  openingContent: string;
  now: Date;
}): Promise<string> {
  const [openingMessage] = await input.db
    .insert(messages)
    .values({
      tenant_id: input.auth.tenantId,
      thread_id: input.thread.threadId,
      role: "system",
      content: input.openingContent,
      sender_type: "system",
      metadata: {
        source: "n8n_agent_step",
        runId: input.run.id,
        workflowId: input.payload.workflowId,
        workflowName: input.payload.workflowName,
        executionId: input.payload.executionId,
        stepId: input.payload.stepId,
        correlationId: input.payload.correlationId,
        requestId: input.payload.requestId,
        hasResumeUrl: Boolean(input.payload.resumeUrl),
      },
      created_at: input.now,
    })
    .returning({ id: messages.id });
  if (!openingMessage?.id) {
    throw new N8nAgentStepStartError(
      "Bridge opening message could not be created",
      500,
    );
  }
  return openingMessage.id;
}

async function createAgentWakeup(input: {
  db: DbLike;
  run: RunRow;
  auth: N8nAgentStepAuthContext;
  payload: ParsedN8nAgentStepStartPayload;
  thread: ThreadRow;
  openingMessageId: string;
  openingContent: string;
  idempotencyKey: string;
  now: Date;
}): Promise<WakeupRow> {
  const [wakeup] = await input.db
    .insert(agentWakeupRequests)
    .values({
      tenant_id: input.auth.tenantId,
      agent_id: input.payload.agentId,
      source: "webhook",
      trigger_detail: `n8n-agent-step:${input.run.id}`,
      reason: `n8n workflow step: ${
        input.payload.workflowName ?? input.payload.workflowId
      }`,
      payload: {
        n8nAgentStepRunId: input.run.id,
        threadId: input.thread.threadId,
        threadIdentifier: input.thread.identifier,
        threadNumber: input.thread.number,
        openingMessageId: input.openingMessageId,
        openingMessageAlreadyPersisted: true,
        openingMessageContent: input.openingContent,
        message: input.payload.instructions,
        workflowId: input.payload.workflowId,
        workflowName: input.payload.workflowName,
        executionId: input.payload.executionId,
        stepId: input.payload.stepId,
        correlationId: input.payload.correlationId,
        requestId: input.payload.requestId,
        webhookPayload: {
          input: input.payload.input,
          metadata: sanitizeN8nAgentStepMetadata(input.payload.metadata),
        },
        spaceId: input.payload.spaceId,
      },
      requested_by_actor_type: "system",
      idempotency_key: input.idempotencyKey,
      requested_at: input.now,
      created_at: input.now,
    })
    .returning({ id: agentWakeupRequests.id });
  if (!wakeup?.id) {
    throw new N8nAgentStepStartError("Agent wakeup could not be queued", 500);
  }
  return wakeup;
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

async function findWakeupByIdempotencyKey(input: {
  db: DbLike;
  tenantId: string;
  agentId: string;
  idempotencyKey: string;
}): Promise<WakeupRow | null> {
  const [wakeup] = await input.db
    .select({ id: agentWakeupRequests.id })
    .from(agentWakeupRequests)
    .where(
      and(
        eq(agentWakeupRequests.tenant_id, input.tenantId),
        eq(agentWakeupRequests.agent_id, input.agentId),
        eq(agentWakeupRequests.idempotency_key, input.idempotencyKey),
      ),
    )
    .limit(1);
  return wakeup ?? null;
}

function shouldRecoverRunStart(run: RunRow, wakeup: WakeupRow | null): boolean {
  if (run.status === "accepted") return true;
  if (run.status !== "waiting") return false;
  return !run.thread_id || !run.opening_message_id || !wakeup?.id;
}

function replayResult(
  run: RunRow,
  wakeup: WakeupRow | null,
): StartN8nAgentStepRunResult {
  return {
    runId: run.id,
    status: run.status,
    replayed: true,
    wakeupRequestId: wakeup?.id ?? null,
    threadId: run.thread_id,
    threadIdentifier: null,
    threadNumber: null,
    openingMessageId: run.opening_message_id,
    expiresAt: run.expires_at.toISOString(),
  };
}

function assertResumeUrlMatchesExistingRun(
  run: RunRow,
  payload: ParsedN8nAgentStepStartPayload,
) {
  if (!payload.resumeUrl) {
    if (run.resume_url_secret_ref) {
      throw new N8nAgentStepStartError(
        "resumeUrl is required to recover this bridge run",
        409,
      );
    }
    return;
  }
  if (!run.resume_url_secret_ref) {
    throw new N8nAgentStepStartError(
      "resumeUrl does not match the original bridge run",
      409,
    );
  }
  if (
    run.resume_url_host !== payload.resumeUrl.host ||
    run.resume_url_path !== payload.resumeUrl.path
  ) {
    throw new N8nAgentStepStartError(
      "resumeUrl does not match the original bridge run",
      409,
    );
  }
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
