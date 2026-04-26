import { randomUUID } from "node:crypto";
import type { S3Client } from "@aws-sdk/client-s3";
import {
  and,
  agentWakeupRequests,
  agentWorkspaceEvents,
  agentWorkspaceRuns,
  agents,
  db as defaultDb,
  eq,
  tenants,
} from "../../graphql/utils.js";
import type {
  CanonicalWorkspaceEventDraft,
  CanonicalWorkspaceEventType,
} from "./canonicalize.js";
import type { ParsedWorkspaceEventKey } from "./key-parser.js";
import {
  workspaceAuditMirrorKey,
  writeWorkspaceAuditMirror,
} from "./s3-mirror.js";

interface TenantRecord {
  id: string;
  slug: string;
  workspace_orchestration_enabled: boolean;
}

interface AgentRecord {
  id: string;
  tenant_id: string;
  slug: string | null;
}

interface WorkspaceRunRecord {
  id: string;
  tenant_id: string;
  agent_id: string;
  target_path: string;
  status: string;
}

interface WorkspaceEventRecord {
  id: number;
}

interface WakeupRequestRecord {
  id: string;
}

interface WorkspaceRunValues {
  id: string;
  tenant_id: string;
  agent_id: string;
  target_path: string;
  status: string;
  source_object_key: string;
  request_object_key?: string;
  depth: number;
  last_event_at: Date;
}

interface WorkspaceRunUpdates {
  status?: string;
  source_object_key?: string;
  completed_at?: Date | null;
  last_event_at: Date;
  updated_at: Date;
}

interface WorkspaceEventValues {
  tenant_id: string;
  agent_id?: string;
  run_id?: string;
  event_type: CanonicalWorkspaceEventType;
  idempotency_key: string;
  bucket: string;
  source_object_key: string;
  object_etag?: string;
  object_version_id?: string;
  sequencer: string;
  reason?: string;
  payload: Record<string, unknown>;
  actor_type?: string;
  actor_id?: string;
}

interface WorkspaceEventMirrorUpdates {
  audit_object_key: string;
  mirror_status: "ok" | "failed";
}

interface WakeupRequestValues {
  tenant_id: string;
  agent_id: string;
  source: string;
  trigger_detail: string;
  reason: string;
  payload: Record<string, unknown>;
  status: string;
  idempotency_key: string;
  requested_by_actor_type: string;
}

export interface WorkspaceEventStore {
  findTenantBySlug(slug: string): Promise<TenantRecord | null>;
  findAgentByTenantAndSlug(
    tenantId: string,
    agentSlug: string,
  ): Promise<AgentRecord | null>;
  findRunById(runId: string): Promise<WorkspaceRunRecord | null>;
  createRun(values: WorkspaceRunValues): Promise<WorkspaceRunRecord>;
  updateRun(runId: string, updates: WorkspaceRunUpdates): Promise<void>;
  updateRunWakeup(runId: string, wakeupRequestId: string): Promise<void>;
  insertEvent(
    values: WorkspaceEventValues,
  ): Promise<WorkspaceEventRecord | null>;
  updateEventMirror(
    eventId: number,
    updates: WorkspaceEventMirrorUpdates,
  ): Promise<void>;
  insertWakeup(values: WakeupRequestValues): Promise<WakeupRequestRecord>;
}

export interface WorkspaceEventProcessorDeps {
  store?: WorkspaceEventStore;
  s3?: S3Client;
  writeAuditMirror?: typeof writeWorkspaceAuditMirror;
  now?: () => Date;
  newRunId?: () => string;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export interface WorkspaceS3EventMetadata {
  bucket: string;
  sourceObjectKey: string;
  sequencer: string;
  detailType: string;
  objectEtag?: string;
  objectVersionId?: string;
}

export type WorkspaceEventProcessResult =
  | { status: "ignored"; reason: string }
  | { status: "duplicate"; idempotencyKey: string }
  | {
      status: "processed";
      eventId: number;
      runId?: string;
      wakeupRequestId?: string;
    };

export async function persistWorkspaceEvent(
  parsedKey: ParsedWorkspaceEventKey,
  draft: CanonicalWorkspaceEventDraft,
  metadata: WorkspaceS3EventMetadata,
  deps: WorkspaceEventProcessorDeps = {},
): Promise<WorkspaceEventProcessResult> {
  const store = deps.store ?? createDrizzleWorkspaceEventStore();
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? console;
  const eventTime = now();

  const tenant = await store.findTenantBySlug(parsedKey.tenantSlug);
  if (!tenant) {
    logger.warn("[workspace-event-processor] tenant_not_found", {
      tenantSlug: parsedKey.tenantSlug,
    });
    return { status: "ignored", reason: "tenant_not_found" };
  }

  if (!tenant.workspace_orchestration_enabled) {
    logger.log("[workspace-event-processor] tenant_disabled", {
      tenantSlug: parsedKey.tenantSlug,
    });
    return { status: "ignored", reason: "tenant_disabled" };
  }

  const agent = await store.findAgentByTenantAndSlug(
    tenant.id,
    parsedKey.agentSlug,
  );
  if (!agent) {
    logger.warn("[workspace-event-processor] agent_not_found", {
      tenantSlug: parsedKey.tenantSlug,
      agentSlug: parsedKey.agentSlug,
    });
    return { status: "ignored", reason: "agent_not_found" };
  }

  const run = await resolveWorkspaceRun(
    store,
    parsedKey,
    draft,
    metadata,
    tenant,
    agent,
    eventTime,
    deps.newRunId ?? randomUUID,
  );

  const event = await store.insertEvent({
    tenant_id: tenant.id,
    agent_id: agent.id,
    run_id: run?.id,
    event_type: draft.eventType,
    idempotency_key: draft.idempotencyKey,
    bucket: metadata.bucket,
    source_object_key: metadata.sourceObjectKey,
    object_etag: metadata.objectEtag,
    object_version_id: metadata.objectVersionId,
    sequencer: metadata.sequencer,
    reason: draft.reason,
    payload: {
      ...draft.payload,
      detailType: metadata.detailType,
      tenantSlug: parsedKey.tenantSlug,
      agentSlug: parsedKey.agentSlug,
    },
  });
  if (!event) {
    return { status: "duplicate", idempotencyKey: draft.idempotencyKey };
  }

  await mirrorAuditEvent(
    {
      eventId: event.id,
      tenantSlug: parsedKey.tenantSlug,
      agentSlug: parsedKey.agentSlug,
      draft,
      metadata,
      runId: run?.id,
      date: eventTime,
    },
    store,
    deps,
    logger,
  );

  const wakeup = await maybeEnqueueWakeup(
    store,
    tenant,
    agent,
    run,
    event.id,
    parsedKey,
    draft,
    metadata,
  );

  return {
    status: "processed",
    eventId: event.id,
    runId: run?.id,
    wakeupRequestId: wakeup?.id,
  };
}

async function resolveWorkspaceRun(
  store: WorkspaceEventStore,
  parsedKey: ParsedWorkspaceEventKey,
  draft: CanonicalWorkspaceEventDraft,
  metadata: WorkspaceS3EventMetadata,
  tenant: TenantRecord,
  agent: AgentRecord,
  eventTime: Date,
  newRunId: () => string,
): Promise<WorkspaceRunRecord | null> {
  if (draft.eventType === "work.requested") {
    return store.createRun({
      id: newRunId(),
      tenant_id: tenant.id,
      agent_id: agent.id,
      target_path: parsedKey.targetPath,
      status: "pending",
      source_object_key: metadata.sourceObjectKey,
      request_object_key: metadata.sourceObjectKey,
      depth: workspaceTargetDepth(parsedKey.targetPath),
      last_event_at: eventTime,
    });
  }

  const run =
    draft.runId && isUuid(draft.runId)
      ? await store.findRunById(draft.runId)
      : null;
  if (!run || run.tenant_id !== tenant.id || run.agent_id !== agent.id) {
    return null;
  }

  const status = runStatusForEvent(draft.eventType);
  if (status) {
    await store.updateRun(run.id, {
      status,
      source_object_key: metadata.sourceObjectKey,
      completed_at:
        status === "completed" || status === "failed" ? eventTime : null,
      last_event_at: eventTime,
      updated_at: eventTime,
    });
    return { ...run, status };
  }

  return run;
}

function runStatusForEvent(
  eventType: CanonicalWorkspaceEventType,
): string | null {
  switch (eventType) {
    case "run.started":
      return "processing";
    case "run.blocked":
      return "awaiting_subrun";
    case "review.requested":
      return "awaiting_review";
    case "run.completed":
      return "completed";
    case "run.failed":
      return "failed";
    default:
      return null;
  }
}

async function mirrorAuditEvent(
  input: {
    eventId: number;
    tenantSlug: string;
    agentSlug: string;
    draft: CanonicalWorkspaceEventDraft;
    metadata: WorkspaceS3EventMetadata;
    runId?: string;
    date: Date;
  },
  store: WorkspaceEventStore,
  deps: WorkspaceEventProcessorDeps,
  logger: Pick<Console, "warn">,
): Promise<void> {
  const auditObjectKey = workspaceAuditMirrorKey({
    tenantSlug: input.tenantSlug,
    agentSlug: input.agentSlug,
    eventId: input.eventId,
    date: input.date,
  });

  if (!deps.s3) {
    await store.updateEventMirror(input.eventId, {
      audit_object_key: auditObjectKey,
      mirror_status: "ok",
    });
    return;
  }

  try {
    await (deps.writeAuditMirror ?? writeWorkspaceAuditMirror)(deps.s3, {
      bucket: input.metadata.bucket,
      key: auditObjectKey,
      body: {
        eventId: input.eventId,
        runId: input.runId,
        eventType: input.draft.eventType,
        idempotencyKey: input.draft.idempotencyKey,
        sourceObjectKey: input.metadata.sourceObjectKey,
        sequencer: input.metadata.sequencer,
        reason: input.draft.reason,
        payload: input.draft.payload,
        createdAt: input.date.toISOString(),
      },
    });
    await store.updateEventMirror(input.eventId, {
      audit_object_key: auditObjectKey,
      mirror_status: "ok",
    });
  } catch (err) {
    logger.warn("[workspace-event-processor] audit_mirror_failed", {
      eventId: input.eventId,
      error: err instanceof Error ? err.message : String(err),
    });
    await store.updateEventMirror(input.eventId, {
      audit_object_key: auditObjectKey,
      mirror_status: "failed",
    });
  }
}

async function maybeEnqueueWakeup(
  store: WorkspaceEventStore,
  tenant: TenantRecord,
  agent: AgentRecord,
  run: WorkspaceRunRecord | null,
  eventId: number,
  parsedKey: ParsedWorkspaceEventKey,
  draft: CanonicalWorkspaceEventDraft,
  metadata: WorkspaceS3EventMetadata,
): Promise<WakeupRequestRecord | null> {
  if (draft.eventType !== "work.requested" || !run) return null;

  const wakeup = await store.insertWakeup({
    tenant_id: tenant.id,
    agent_id: agent.id,
    source: "workspace_event",
    trigger_detail: `workspace_event:${eventId}`,
    reason: `Workspace request: ${parsedKey.workspaceRelativePath}`,
    payload: {
      workspaceRunId: run.id,
      workspaceEventId: eventId,
      targetPath: parsedKey.targetPath,
      workspaceRelativePath: parsedKey.workspaceRelativePath,
      sourceObjectKey: metadata.sourceObjectKey,
      causeType: draft.eventType,
    },
    status: "queued",
    idempotency_key: draft.idempotencyKey,
    requested_by_actor_type: "system",
  });
  await store.updateRunWakeup(run.id, wakeup.id);
  return wakeup;
}

function workspaceTargetDepth(targetPath: string): number {
  if (!targetPath) return 0;
  return targetPath.split("/").filter(Boolean).length;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function createDrizzleWorkspaceEventStore(
  database = defaultDb,
): WorkspaceEventStore {
  return {
    async findTenantBySlug(slug) {
      const [tenant] = await database
        .select({
          id: tenants.id,
          slug: tenants.slug,
          workspace_orchestration_enabled:
            tenants.workspace_orchestration_enabled,
        })
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1);
      return tenant ?? null;
    },
    async findAgentByTenantAndSlug(tenantId, agentSlug) {
      const [agent] = await database
        .select({
          id: agents.id,
          tenant_id: agents.tenant_id,
          slug: agents.slug,
        })
        .from(agents)
        .where(and(eq(agents.tenant_id, tenantId), eq(agents.slug, agentSlug)))
        .limit(1);
      return agent ?? null;
    },
    async findRunById(runId) {
      const [run] = await database
        .select({
          id: agentWorkspaceRuns.id,
          tenant_id: agentWorkspaceRuns.tenant_id,
          agent_id: agentWorkspaceRuns.agent_id,
          target_path: agentWorkspaceRuns.target_path,
          status: agentWorkspaceRuns.status,
        })
        .from(agentWorkspaceRuns)
        .where(eq(agentWorkspaceRuns.id, runId))
        .limit(1);
      return run ?? null;
    },
    async createRun(values) {
      const [run] = await database
        .insert(agentWorkspaceRuns)
        .values(values)
        .returning({
          id: agentWorkspaceRuns.id,
          tenant_id: agentWorkspaceRuns.tenant_id,
          agent_id: agentWorkspaceRuns.agent_id,
          target_path: agentWorkspaceRuns.target_path,
          status: agentWorkspaceRuns.status,
        });
      if (!run) throw new Error("workspace_run_insert_failed");
      return run;
    },
    async updateRun(runId, updates) {
      await database
        .update(agentWorkspaceRuns)
        .set(updates)
        .where(eq(agentWorkspaceRuns.id, runId));
    },
    async updateRunWakeup(runId, wakeupRequestId) {
      await database
        .update(agentWorkspaceRuns)
        .set({
          current_wakeup_request_id: wakeupRequestId,
          updated_at: new Date(),
        })
        .where(eq(agentWorkspaceRuns.id, runId));
    },
    async insertEvent(values) {
      const [event] = await database
        .insert(agentWorkspaceEvents)
        .values(values)
        .onConflictDoNothing({
          target: [
            agentWorkspaceEvents.tenant_id,
            agentWorkspaceEvents.idempotency_key,
          ],
        })
        .returning({ id: agentWorkspaceEvents.id });
      return event ?? null;
    },
    async updateEventMirror(eventId, updates) {
      await database
        .update(agentWorkspaceEvents)
        .set(updates)
        .where(eq(agentWorkspaceEvents.id, eventId));
    },
    async insertWakeup(values) {
      const [wakeup] = await database
        .insert(agentWakeupRequests)
        .values(values)
        .returning({ id: agentWakeupRequests.id });
      if (!wakeup) throw new Error("workspace_wakeup_insert_failed");
      return wakeup;
    },
  };
}
