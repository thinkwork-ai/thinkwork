import { GraphQLError } from "graphql";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import { createHash, randomUUID } from "node:crypto";

import type { GraphQLContext } from "../../graphql/context.js";
import {
  and,
  asc,
  db,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
  spaceMembers,
  spaces,
  workItemDocuments,
  workItemEvents,
  workItemLabelAssignments,
  workItemLabels,
  workItemStatuses,
  workItemThreadLinks,
  workItems,
} from "../../graphql/utils.js";
import { resolveCallerUserId } from "../../graphql/resolvers/core/resolve-auth-user.js";
import { canReadTenantSpaces } from "../../graphql/resolvers/spaces/shared.js";
import { requireWorkItemSpaceAccess, resolveWorkItemTenant } from "./auth.js";
import {
  findStatusForWorkItemUpdate,
  normalizeWorkItemStatusCategory,
} from "./status-service.js";

export type WorkItemPriority = "low" | "normal" | "high" | "urgent";
export type WorkItemDocumentKind =
  | "plan"
  | "progress"
  | "spec"
  | "evidence"
  | "handoff"
  | "note"
  | "other";
export type OpenEngineHumanActionType =
  | "answer_blocker"
  | "release_hold"
  | "request_review"
  | "mark_reviewed"
  | "mark_blocked"
  | "mark_failed";

const WORK_ITEM_DOCUMENT_KINDS = new Set<WorkItemDocumentKind>([
  "plan",
  "progress",
  "spec",
  "evidence",
  "handoff",
  "note",
  "other",
]);
const MAX_WORK_ITEM_DOCUMENT_BYTES = 2 * 1024 * 1024;
const workItemDocumentS3 = new S3Client({});

export async function listWorkItems(
  ctx: GraphQLContext,
  input: Record<string, any> = {},
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  if (!(await canReadTenantSpaces(ctx, tenantId))) return [];
  if (input.spaceId) {
    try {
      await requireWorkItemSpaceAccess(ctx, tenantId, input.spaceId);
    } catch {
      return [];
    }
  }

  const conditions: any[] = [eq(workItems.tenant_id, tenantId)];
  if (input.spaceId) conditions.push(eq(workItems.space_id, input.spaceId));
  if (!input.includeArchived) conditions.push(isNull(workItems.archived_at));
  if (input.statusId) conditions.push(eq(workItems.status_id, input.statusId));
  if (input.ownerUserId) {
    conditions.push(eq(workItems.owner_user_id, input.ownerUserId));
  }
  if (input.ownerAgentId) {
    conditions.push(eq(workItems.owner_agent_id, input.ownerAgentId));
  }
  if (input.blocked !== undefined && input.blocked !== null) {
    conditions.push(eq(workItems.blocked, Boolean(input.blocked)));
  }
  if (input.required !== undefined && input.required !== null) {
    conditions.push(eq(workItems.required, Boolean(input.required)));
  }
  if (input.applicable !== undefined && input.applicable !== null) {
    conditions.push(eq(workItems.applicable, Boolean(input.applicable)));
  }
  if (Array.isArray(input.labelIds) && input.labelIds.length > 0) {
    conditions.push(labelAssignmentExistsPredicate(tenantId, input.labelIds));
  }
  if (Array.isArray(input.labelSlugs) && input.labelSlugs.length > 0) {
    const slugs = normalizeLabelSlugs(input.labelSlugs);
    if (slugs.length > 0) {
      conditions.push(
        labelAssignmentExistsPredicate(tenantId, undefined, slugs),
      );
    }
  }
  if (input.priority) {
    conditions.push(
      eq(workItems.priority, normalizeWorkItemPriority(input.priority)),
    );
  }
  if (input.dueAfter)
    conditions.push(gte(workItems.due_at, new Date(input.dueAfter)));
  if (input.dueBefore) {
    conditions.push(lte(workItems.due_at, new Date(input.dueBefore)));
  }
  if (input.statusCategory) {
    const category = normalizeWorkItemStatusCategory(input.statusCategory);
    conditions.push(sql`EXISTS (
      SELECT 1
        FROM ${workItemStatuses} wis
       WHERE wis.id = ${workItems.status_id}
         AND wis.tenant_id = ${tenantId}
         AND wis.space_id = ${workItems.space_id}
         AND wis.category = ${category}
    )`);
  }
  if (input.threadId) {
    conditions.push(sql`EXISTS (
      SELECT 1
        FROM ${workItemThreadLinks} witl
       WHERE witl.tenant_id = ${tenantId}
         AND witl.work_item_id = ${workItems.id}
         AND witl.thread_id = ${input.threadId}
    )`);
  }

  const search = typeof input.search === "string" ? input.search.trim() : "";
  if (search) {
    conditions.push(
      or(
        sql`${workItems.title} ILIKE ${`%${search}%`}`,
        sql`${workItems.notes} ILIKE ${`%${search}%`}`,
      ),
    );
  }

  const callerUserId =
    ctx.auth?.authType === "cognito" ? await resolveCallerUserId(ctx) : null;
  if (ctx.auth?.authType === "cognito") {
    if (!callerUserId) return [];
    conditions.push(visibleSpaceExistsPredicate(tenantId, callerUserId));
  }

  return db
    .select()
    .from(workItems)
    .where(and(...conditions))
    .orderBy(desc(workItems.updated_at))
    .limit(clampLimit(input.limit));
}

export async function getWorkItem(
  ctx: GraphQLContext,
  input: { tenantId?: string | null; id: string },
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  const [item] = await db
    .select()
    .from(workItems)
    .where(and(eq(workItems.tenant_id, tenantId), eq(workItems.id, input.id)));
  if (!item) return null;
  try {
    await requireWorkItemSpaceAccess(ctx, tenantId, item.space_id);
  } catch {
    return null;
  }
  return item;
}

export async function createWorkItem(
  ctx: GraphQLContext,
  input: Record<string, any>,
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  await requireWorkItemSpaceAccess(ctx, tenantId, input.spaceId);
  const callerUserId = await resolveCallerUserId(ctx).catch(() => null);

  return db.transaction(async (tx) => {
    const status = await findStatusForWorkItemUpdate({
      tenantId,
      spaceId: input.spaceId,
      statusId: input.statusId,
      tx: tx as unknown as typeof db,
    });
    const now = new Date();
    const [created] = await tx
      .insert(workItems)
      .values({
        tenant_id: tenantId,
        space_id: input.spaceId,
        status_id: status.id,
        title: requireNonEmpty(input.title, "title"),
        notes: optionalTrim(input.notes),
        priority: input.priority
          ? normalizeWorkItemPriority(input.priority)
          : "normal",
        owner_user_id: input.ownerUserId ?? null,
        owner_agent_id: input.ownerAgentId ?? null,
        due_at: input.dueAt ? new Date(input.dueAt) : null,
        required: input.required ?? true,
        applicable: input.applicable ?? true,
        blocked: input.blocked ?? status.category === "blocked",
        completed_at:
          status.is_final && status.category === "done" ? now : null,
        completed_by_user_id:
          status.is_final && status.category === "done" ? callerUserId : null,
        template_source_id: input.templateSourceId ?? null,
        created_by_user_id: callerUserId,
        metadata: parseAwsJsonObject(input.metadata),
        open_engine_enabled: Boolean(
          input.openEngineEnabled ?? input.open_engine_enabled ?? false,
        ),
        open_engine_queue_key: optionalTrim(
          input.openEngineQueueKey ?? input.open_engine_queue_key,
        ),
        open_engine_scheduled_at: optionalDate(
          input.openEngineScheduledAt ?? input.open_engine_scheduled_at,
        ),
        open_engine_dependency_state: normalizeOpenEngineDependencyState(
          input.openEngineDependencyState ??
            input.open_engine_dependency_state ??
            "ready",
        ),
        open_engine_routing: parseAwsJsonObject(
          input.openEngineRouting ?? input.open_engine_routing,
        ),
        updated_at: now,
      })
      .returning();

    if (input.threadId) {
      await tx.insert(workItemThreadLinks).values({
        tenant_id: tenantId,
        work_item_id: created.id,
        thread_id: input.threadId,
        space_id: input.spaceId,
        relationship: "primary",
      });
    }

    await replaceWorkItemLabels(tx as unknown as typeof db, {
      tenantId,
      workItemId: created.id,
      callerUserId,
      labelIds: input.labelIds,
      labelSlugs: input.labelSlugs,
    });

    await tx.insert(workItemEvents).values({
      tenant_id: tenantId,
      space_id: input.spaceId,
      work_item_id: created.id,
      thread_id: input.threadId ?? null,
      actor_user_id: callerUserId,
      event_type: "created",
      new_status_id: status.id,
      message: `${created.title} created.`,
      metadata: compactObject({
        source: "graphql",
        inputMetadata: parseAwsJsonObject(input.metadata),
      }),
    });

    return created;
  });
}

export async function updateWorkItem(
  ctx: GraphQLContext,
  input: Record<string, any>,
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  const item = await loadAuthorizedWorkItem(ctx, tenantId, input.workItemId);
  const now = new Date();
  const updates: Record<string, unknown> = { updated_at: now };

  if (input.title !== undefined)
    updates.title = requireNonEmpty(input.title, "title");
  if (input.notes !== undefined) updates.notes = optionalTrim(input.notes);
  if (input.priority !== undefined) {
    updates.priority = normalizeWorkItemPriority(input.priority);
  }
  if (input.ownerUserId !== undefined)
    updates.owner_user_id = input.ownerUserId;
  if (input.ownerAgentId !== undefined)
    updates.owner_agent_id = input.ownerAgentId;
  if (input.dueAt !== undefined) {
    updates.due_at = input.dueAt ? new Date(input.dueAt) : null;
  }
  if (input.required !== undefined) updates.required = Boolean(input.required);
  if (input.applicable !== undefined) {
    updates.applicable = Boolean(input.applicable);
  }
  if (input.blocked !== undefined) updates.blocked = Boolean(input.blocked);
  if (input.metadata !== undefined)
    updates.metadata = parseAwsJsonObject(input.metadata);
  if (input.openEngineEnabled !== undefined) {
    updates.open_engine_enabled = Boolean(input.openEngineEnabled);
  }
  if (input.openEngineQueueKey !== undefined) {
    updates.open_engine_queue_key = optionalTrim(input.openEngineQueueKey);
  }
  if (input.openEngineScheduledAt !== undefined) {
    updates.open_engine_scheduled_at = optionalDate(
      input.openEngineScheduledAt,
    );
  }
  if (input.openEngineDependencyState !== undefined) {
    updates.open_engine_dependency_state = normalizeOpenEngineDependencyState(
      input.openEngineDependencyState,
    );
  }
  if (input.openEngineRouting !== undefined) {
    updates.open_engine_routing = parseAwsJsonObject(input.openEngineRouting);
  }
  if (input.archived !== undefined) {
    updates.archived_at = input.archived ? now : null;
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(workItems)
      .set(updates)
      .where(and(eq(workItems.tenant_id, tenantId), eq(workItems.id, item.id)))
      .returning();
    if (input.labelIds !== undefined || input.labelSlugs !== undefined) {
      await replaceWorkItemLabels(tx as unknown as typeof db, {
        tenantId,
        workItemId: item.id,
        callerUserId: await resolveCallerUserId(ctx).catch(() => null),
        labelIds: input.labelIds,
        labelSlugs: input.labelSlugs,
      });
    }
    await tx.insert(workItemEvents).values({
      tenant_id: tenantId,
      space_id: item.space_id,
      work_item_id: item.id,
      actor_user_id: await resolveCallerUserId(ctx).catch(() => null),
      event_type: "updated",
      message: `${item.title} updated.`,
      metadata: compactObject({ changedFields: Object.keys(updates).sort() }),
    });
    return updated;
  });
}

export async function listWorkItemLabels(
  ctx: GraphQLContext,
  input: Record<string, any> = {},
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  if (!(await canReadTenantSpaces(ctx, tenantId))) return [];
  const conditions: any[] = [eq(workItemLabels.tenant_id, tenantId)];
  if (!input.includeArchived)
    conditions.push(isNull(workItemLabels.archived_at));
  const search = typeof input.search === "string" ? input.search.trim() : "";
  if (search) {
    conditions.push(
      or(
        sql`${workItemLabels.name} ILIKE ${`%${search}%`}`,
        sql`${workItemLabels.slug} ILIKE ${`%${search}%`}`,
      ),
    );
  }
  return db
    .select()
    .from(workItemLabels)
    .where(and(...conditions))
    .orderBy(asc(workItemLabels.name))
    .limit(clampLimit(input.limit));
}

export async function createWorkItemLabel(
  ctx: GraphQLContext,
  input: Record<string, any>,
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  if (!(await canReadTenantSpaces(ctx, tenantId))) {
    throw new GraphQLError("Not authorized for this tenant", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  const now = new Date();
  const [created] = await db
    .insert(workItemLabels)
    .values({
      tenant_id: tenantId,
      name: requireNonEmpty(input.name, "name"),
      slug: normalizeLabelSlug(input.slug ?? input.name),
      color: optionalTrim(input.color),
      description: optionalTrim(input.description),
      created_by_user_id: await resolveCallerUserId(ctx).catch(() => null),
      updated_at: now,
    })
    .returning();
  return created;
}

export async function updateWorkItemLabel(
  ctx: GraphQLContext,
  input: Record<string, any>,
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  if (!(await canReadTenantSpaces(ctx, tenantId))) {
    throw new GraphQLError("Not authorized for this tenant", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (input.name !== undefined)
    updates.name = requireNonEmpty(input.name, "name");
  if (input.slug !== undefined) updates.slug = normalizeLabelSlug(input.slug);
  if (input.color !== undefined) updates.color = optionalTrim(input.color);
  if (input.description !== undefined) {
    updates.description = optionalTrim(input.description);
  }
  if (input.archived !== undefined) {
    updates.archived_at = input.archived ? new Date() : null;
  }

  const [updated] = await db
    .update(workItemLabels)
    .set(updates)
    .where(
      and(
        eq(workItemLabels.tenant_id, tenantId),
        eq(workItemLabels.id, input.id),
      ),
    )
    .returning();
  if (!updated) {
    throw new GraphQLError("Work Item label not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  return updated;
}

export async function listWorkItemDocuments(
  ctx: GraphQLContext,
  input: Record<string, any> = {},
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  await loadAuthorizedWorkItem(ctx, tenantId, input.workItemId);

  const conditions: any[] = [
    eq(workItemDocuments.tenant_id, tenantId),
    eq(workItemDocuments.work_item_id, input.workItemId),
  ];
  if (!input.includeArchived) {
    conditions.push(isNull(workItemDocuments.archived_at));
  }
  if (input.kind) {
    conditions.push(
      eq(workItemDocuments.kind, normalizeWorkItemDocumentKind(input.kind)),
    );
  }

  const rows = await db
    .select()
    .from(workItemDocuments)
    .where(and(...conditions))
    .orderBy(desc(workItemDocuments.updated_at))
    .limit(clampLimit(input.limit));

  if (!input.includeContent) return rows;
  return Promise.all(rows.map((row) => hydrateWorkItemDocumentContent(row)));
}

export async function getWorkItemDocument(
  ctx: GraphQLContext,
  input: { tenantId?: string | null; id: string },
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  const [document] = await db
    .select()
    .from(workItemDocuments)
    .where(
      and(
        eq(workItemDocuments.tenant_id, tenantId),
        eq(workItemDocuments.id, input.id),
      ),
    );
  if (!document) return null;
  await loadAuthorizedWorkItem(ctx, tenantId, document.work_item_id);
  return hydrateWorkItemDocumentContent(document);
}

export async function createWorkItemDocument(
  ctx: GraphQLContext,
  input: Record<string, any>,
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  const item = await loadAuthorizedWorkItem(ctx, tenantId, input.workItemId);
  const callerUserId = await resolveCallerUserId(ctx).catch(() => null);
  const now = new Date();
  const id = randomUUID();
  const payload = resolveCreateDocumentPayload(input);
  const contentType = payload.contentType;
  const contentBuffer = payload.buffer;
  const checksum = sha256(contentBuffer);
  const s3Key = buildWorkItemDocumentS3Key(
    tenantId,
    item.id,
    id,
    contentType,
    input.filename,
  );
  const metadata = documentMetadata(input);

  validateDocumentSize(contentBuffer);
  await putWorkItemDocumentContent({
    s3Key,
    contentType,
    body: contentBuffer,
    tenantId,
    workItemId: item.id,
    documentId: id,
  });

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(workItemDocuments)
      .values({
        id,
        tenant_id: tenantId,
        work_item_id: item.id,
        kind: input.kind ? normalizeWorkItemDocumentKind(input.kind) : "note",
        title: requireNonEmpty(input.title, "title"),
        content_type: contentType,
        s3_key: s3Key,
        size_bytes: contentBuffer.byteLength,
        checksum_sha256: checksum,
        metadata,
        created_by_user_id: callerUserId,
        updated_at: now,
      })
      .returning();

    await tx.insert(workItemEvents).values({
      tenant_id: tenantId,
      space_id: item.space_id,
      work_item_id: item.id,
      actor_user_id: callerUserId,
      event_type: "updated",
      message: `${created.title} document created.`,
      metadata: compactObject({
        source: "graphql",
        action: "document_created",
        documentId: created.id,
        kind: created.kind,
      }),
    });

    return { ...created, content: payload.previewContent };
  });
}

export async function updateWorkItemDocument(
  ctx: GraphQLContext,
  input: Record<string, any>,
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  const [document] = await db
    .select()
    .from(workItemDocuments)
    .where(
      and(
        eq(workItemDocuments.tenant_id, tenantId),
        eq(workItemDocuments.id, input.id),
      ),
    );
  if (!document) {
    throw new GraphQLError("Work Item document not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  const item = await loadAuthorizedWorkItem(
    ctx,
    tenantId,
    document.work_item_id,
  );
  const callerUserId = await resolveCallerUserId(ctx).catch(() => null);
  const now = new Date();
  const updates: Record<string, unknown> = { updated_at: now };
  let updatedContent: string | null | undefined;

  if (input.title !== undefined) {
    updates.title = requireNonEmpty(input.title, "title");
  }
  if (input.kind !== undefined) {
    updates.kind = normalizeWorkItemDocumentKind(input.kind);
  }
  if (input.metadata !== undefined || input.filename !== undefined) {
    updates.metadata = documentMetadata({
      metadata:
        input.metadata !== undefined ? input.metadata : document.metadata,
      filename: input.filename,
    });
  }
  if (input.archived !== undefined) {
    updates.archived_at = input.archived ? now : null;
  }
  if (
    input.content !== undefined ||
    input.contentBase64 !== undefined ||
    input.contentType !== undefined
  ) {
    const payload =
      input.contentBase64 !== undefined || input.content !== undefined
        ? resolveCreateDocumentPayload({
            content: input.content,
            contentBase64: input.contentBase64,
            contentType: input.contentType ?? document.content_type,
          })
        : resolveExistingDocumentPayload(
            await readWorkItemDocumentContentBuffer(document.s3_key),
            input.contentType ?? document.content_type,
          );
    const contentBuffer = payload.buffer;
    const contentType = payload.contentType;
    validateDocumentSize(contentBuffer);
    await putWorkItemDocumentContent({
      s3Key: document.s3_key,
      contentType,
      body: contentBuffer,
      tenantId,
      workItemId: item.id,
      documentId: document.id,
    });
    updates.content_type = contentType;
    updates.size_bytes = contentBuffer.byteLength;
    updates.checksum_sha256 = sha256(contentBuffer);
    updatedContent = payload.previewContent;
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(workItemDocuments)
      .set(updates)
      .where(
        and(
          eq(workItemDocuments.tenant_id, tenantId),
          eq(workItemDocuments.id, document.id),
        ),
      )
      .returning();

    await tx.insert(workItemEvents).values({
      tenant_id: tenantId,
      space_id: item.space_id,
      work_item_id: item.id,
      actor_user_id: callerUserId,
      event_type: "updated",
      message:
        input.archived === true
          ? `${updated.title} document archived.`
          : `${updated.title} document updated.`,
      metadata: compactObject({
        source: "graphql",
        action:
          input.archived === true ? "document_archived" : "document_updated",
        documentId: updated.id,
        changedFields: Object.keys(updates).sort(),
      }),
    });

    return {
      ...updated,
      content:
        updatedContent !== undefined
          ? updatedContent
          : input.archived === true ||
              !isPreviewableContentType(updated.content_type)
            ? null
            : await readWorkItemDocumentContent(updated.s3_key),
    };
  });
}

export async function updateWorkItemStatus(
  ctx: GraphQLContext,
  input: Record<string, any>,
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  const item = await loadAuthorizedWorkItem(ctx, tenantId, input.workItemId);
  const callerUserId = await resolveCallerUserId(ctx).catch(() => null);

  return db.transaction(async (tx) => {
    const status = await findStatusForWorkItemUpdate({
      tenantId,
      spaceId: item.space_id,
      statusId: input.statusId,
      statusCategory: input.statusCategory,
      tx: tx as unknown as typeof db,
    });
    const now = new Date();
    const [updated] = await tx
      .update(workItems)
      .set({
        status_id: status.id,
        blocked: status.category === "blocked",
        completed_at:
          status.category === "done" || status.category === "skipped"
            ? now
            : null,
        completed_by_user_id:
          status.category === "done" || status.category === "skipped"
            ? callerUserId
            : null,
        completed_by_agent_id: null,
        updated_at: now,
      })
      .where(and(eq(workItems.tenant_id, tenantId), eq(workItems.id, item.id)))
      .returning();

    await tx.insert(workItemEvents).values({
      tenant_id: tenantId,
      space_id: item.space_id,
      work_item_id: item.id,
      thread_id: input.threadId ?? null,
      actor_user_id: callerUserId,
      event_type: eventTypeForStatus(status.category),
      previous_status_id: item.status_id,
      new_status_id: status.id,
      message: buildStatusMessage(item.title, status.name, input.note),
      metadata: compactObject({
        source: "graphql",
        note: optionalTrim(input.note),
        inputMetadata: parseAwsJsonObject(input.metadata),
      }),
    });

    return updated;
  });
}

export async function recordOpenEngineHumanAction(
  ctx: GraphQLContext,
  input: Record<string, any>,
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  const item = await loadAuthorizedWorkItem(ctx, tenantId, input.workItemId);
  const callerUserId = await resolveCallerUserId(ctx).catch(() => null);
  if (!callerUserId) {
    throw new GraphQLError("Open Engine human actions require a user", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  const actionType = normalizeOpenEngineHumanActionType(input.actionType);
  const now = input.now ? (optionalDate(input.now) ?? new Date()) : new Date();
  const message = optionalTrim(input.message) ?? defaultHumanActionMessage(actionType);
  const evidence = parseAwsJsonObject(input.evidence);
  const metadata = parseAwsJsonObject(input.metadata);
  const idempotencyKey = optionalTrim(input.idempotencyKey);

  return db.transaction(async (tx) => {
    if (idempotencyKey) {
      const [existing] = await tx
        .select()
        .from(workItemEvents)
        .where(
          and(
            eq(workItemEvents.tenant_id, tenantId),
            eq(workItemEvents.work_item_id, item.id),
            eq(workItemEvents.actor_user_id, callerUserId),
            sql`${workItemEvents.metadata}->>'idempotencyKey' = ${idempotencyKey}`,
          ),
        );
      if (existing) return existing;
    }

    const [updated] = await tx
      .update(workItems)
      .set(openEngineHumanActionUpdate(actionType, message, now))
      .where(and(eq(workItems.tenant_id, tenantId), eq(workItems.id, item.id)))
      .returning();
    if (!updated) {
      throw new GraphQLError("Work item could not be updated", {
        extensions: { code: "INTERNAL_SERVER_ERROR" },
      });
    }

    const [event] = await tx
      .insert(workItemEvents)
      .values({
        tenant_id: tenantId,
        space_id: item.space_id,
        work_item_id: item.id,
        actor_user_id: callerUserId,
        event_type: eventTypeForHumanAction(actionType),
        message,
        metadata: compactObject({
          source: "open_engine_human_action",
          actionType,
          evidence: evidence ?? undefined,
          inputMetadata: metadata ?? undefined,
          idempotencyKey: idempotencyKey ?? undefined,
        }),
      })
      .returning();
    if (!event) {
      throw new GraphQLError("Open Engine human action could not be recorded", {
        extensions: { code: "INTERNAL_SERVER_ERROR" },
      });
    }
    return event;
  });
}

export async function listThreadWorkItems(
  ctx: GraphQLContext,
  input: { tenantId?: string | null; threadId: string },
) {
  return listWorkItems(ctx, {
    tenantId: input.tenantId,
    threadId: input.threadId,
    includeArchived: false,
    limit: 500,
  });
}

async function loadAuthorizedWorkItem(
  ctx: GraphQLContext,
  tenantId: string,
  workItemId: string,
) {
  const [item] = await db
    .select()
    .from(workItems)
    .where(
      and(eq(workItems.tenant_id, tenantId), eq(workItems.id, workItemId)),
    );
  if (!item) {
    throw new GraphQLError("Work item not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await requireWorkItemSpaceAccess(ctx, tenantId, item.space_id);
  return item;
}

function visibleSpaceExistsPredicate(tenantId: string, callerUserId: string) {
  return sql`EXISTS (
    SELECT 1
      FROM ${spaces} visible_spaces
     WHERE visible_spaces.id = ${workItems.space_id}
       AND visible_spaces.tenant_id = ${tenantId}
       AND visible_spaces.status = 'active'
       AND (
         visible_spaces.access_mode = 'public'
         OR EXISTS (
           SELECT 1
             FROM ${spaceMembers} visible_space_members
            WHERE visible_space_members.tenant_id = ${tenantId}
              AND visible_space_members.space_id = visible_spaces.id
              AND visible_space_members.user_id = ${callerUserId}
         )
       )
  )`;
}

function labelAssignmentExistsPredicate(
  tenantId: string,
  labelIds?: string[],
  labelSlugs?: string[],
) {
  const filterValues = labelIds?.length ? labelIds : (labelSlugs ?? []);
  const filterColumn = labelIds?.length ? sql`wila.label_id` : sql`wil.slug`;
  return sql`EXISTS (
    SELECT 1
      FROM ${workItemLabelAssignments} wila
      JOIN ${workItemLabels} wil
        ON wil.id = wila.label_id
       AND wil.tenant_id = wila.tenant_id
     WHERE wila.tenant_id = ${tenantId}
       AND wila.work_item_id = ${workItems.id}
       AND wil.archived_at IS NULL
       AND ${filterColumn} IN (${sql.join(
         filterValues.map((value) => sql`${value}`),
         sql`, `,
       )})
  )`;
}

async function replaceWorkItemLabels(
  tx: typeof db,
  input: {
    tenantId: string;
    workItemId: string;
    callerUserId: string | null;
    labelIds?: unknown;
    labelSlugs?: unknown;
  },
) {
  if (input.labelIds === undefined && input.labelSlugs === undefined) return;
  const labelIds = await resolveWorkItemLabelIds(tx, input);
  await tx
    .delete(workItemLabelAssignments)
    .where(
      and(
        eq(workItemLabelAssignments.tenant_id, input.tenantId),
        eq(workItemLabelAssignments.work_item_id, input.workItemId),
      ),
    );
  if (labelIds.length === 0) return;
  await tx
    .insert(workItemLabelAssignments)
    .values(
      labelIds.map((labelId) => ({
        tenant_id: input.tenantId,
        work_item_id: input.workItemId,
        label_id: labelId,
        created_by_user_id: input.callerUserId,
      })),
    )
    .onConflictDoNothing();
}

async function resolveWorkItemLabelIds(
  tx: typeof db,
  input: {
    tenantId: string;
    labelIds?: unknown;
    labelSlugs?: unknown;
  },
) {
  const requestedIds = normalizeIdList(input.labelIds);
  const requestedSlugs = normalizeLabelSlugs(input.labelSlugs);
  if (requestedIds.length === 0 && requestedSlugs.length === 0) return [];

  const conditions: any[] = [
    eq(workItemLabels.tenant_id, input.tenantId),
    isNull(workItemLabels.archived_at),
  ];
  const disjunctions: any[] = [];
  if (requestedIds.length > 0) {
    disjunctions.push(inArray(workItemLabels.id, requestedIds));
  }
  if (requestedSlugs.length > 0) {
    disjunctions.push(inArray(workItemLabels.slug, requestedSlugs));
  }
  conditions.push(
    disjunctions.length === 1 ? disjunctions[0] : or(...disjunctions),
  );

  const rows = await tx
    .select({ id: workItemLabels.id, slug: workItemLabels.slug })
    .from(workItemLabels)
    .where(and(...conditions));
  const resolved = [...new Set(rows.map((row) => row.id))];
  const resolvedIds = new Set(rows.map((row) => row.id));
  const resolvedSlugs = new Set(rows.map((row) => row.slug));
  const missingId = requestedIds.some((id) => !resolvedIds.has(id));
  const missingSlug = requestedSlugs.some((slug) => !resolvedSlugs.has(slug));
  if (missingId || missingSlug) {
    throw new GraphQLError("One or more Work Item labels were not found", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return resolved;
}

export function normalizeWorkItemPriority(value: unknown): WorkItemPriority {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (
    normalized === "low" ||
    normalized === "normal" ||
    normalized === "high" ||
    normalized === "urgent"
  ) {
    return normalized;
  }
  throw new GraphQLError(`Unsupported work item priority: ${value}`, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

function normalizeOpenEngineDependencyState(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (normalized === "ready" || normalized === "waiting") return normalized;
  throw new GraphQLError(`Unsupported Open Engine dependency state: ${value}`, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

function normalizeOpenEngineHumanActionType(
  value: unknown,
): OpenEngineHumanActionType {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (
    normalized === "answer_blocker" ||
    normalized === "release_hold" ||
    normalized === "request_review" ||
    normalized === "mark_reviewed" ||
    normalized === "mark_blocked" ||
    normalized === "mark_failed"
  ) {
    return normalized;
  }
  throw new GraphQLError(`Unsupported Open Engine human action: ${value}`, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

function optionalDate(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new GraphQLError("Date fields must be valid ISO date strings", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return date;
}

function openEngineHumanActionUpdate(
  actionType: OpenEngineHumanActionType,
  message: string,
  now: Date,
) {
  const releaseForPickup = {
    blocked: false,
    open_engine_human_hold: false,
    open_engine_human_hold_reason: null,
    open_engine_dependency_state: "ready",
    open_engine_claimed_by_agent_id: null,
    open_engine_claimed_at: null,
    open_engine_claim_expires_at: null,
    updated_at: now,
  };
  if (
    actionType === "answer_blocker" ||
    actionType === "release_hold" ||
    actionType === "mark_reviewed"
  ) {
    return releaseForPickup;
  }
  if (actionType === "request_review") {
    return {
      blocked: false,
      open_engine_human_hold: true,
      open_engine_human_hold_reason: message,
      open_engine_dependency_state: "waiting",
      open_engine_claimed_by_agent_id: null,
      open_engine_claimed_at: null,
      open_engine_claim_expires_at: null,
      updated_at: now,
    };
  }
  return {
    blocked: true,
    open_engine_human_hold: true,
    open_engine_human_hold_reason: message,
    open_engine_dependency_state: "waiting",
    open_engine_claimed_by_agent_id: null,
    open_engine_claimed_at: null,
    open_engine_claim_expires_at: null,
    updated_at: now,
  };
}

function eventTypeForHumanAction(actionType: OpenEngineHumanActionType) {
  if (actionType === "answer_blocker" || actionType === "release_hold") {
    return "unblocked";
  }
  if (actionType === "mark_blocked" || actionType === "mark_failed") {
    return "blocked";
  }
  return "status_changed";
}

function defaultHumanActionMessage(actionType: OpenEngineHumanActionType) {
  switch (actionType) {
    case "answer_blocker":
      return "Human answered the OpenEngine blocker.";
    case "release_hold":
      return "Human released the OpenEngine hold.";
    case "request_review":
      return "Human requested OpenEngine review.";
    case "mark_reviewed":
      return "Human marked OpenEngine work reviewed.";
    case "mark_blocked":
      return "Human marked OpenEngine work blocked.";
    case "mark_failed":
      return "Human marked OpenEngine work failed.";
  }
}

function eventTypeForStatus(category: string) {
  if (category === "done" || category === "skipped") return "completed";
  if (category === "blocked") return "blocked";
  return "status_changed";
}

function buildStatusMessage(
  title: string,
  statusName: string,
  note: string | null | undefined,
) {
  const suffix = optionalTrim(note) ? ` Note: ${optionalTrim(note)}` : "";
  return `${title} moved to ${statusName}.${suffix}`;
}

function clampLimit(value: unknown) {
  const parsed = Number(value ?? 100);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(Math.max(Math.trunc(parsed), 1), 500);
}

export function parseAwsJsonObject(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GraphQLError("metadata/config fields must be JSON objects", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return parsed as Record<string, unknown>;
}

function requireNonEmpty(value: unknown, field: string) {
  const trimmed = optionalTrim(value);
  if (!trimmed) {
    throw new GraphQLError(`${field} is required`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return trimmed;
}

function optionalTrim(value: unknown) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((child) => optionalTrim(child))
        .filter((child): child is string => Boolean(child)),
    ),
  ];
}

function normalizeLabelSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeLabelSlug))].filter(Boolean);
}

function normalizeLabelSlug(value: unknown) {
  const slug = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) {
    throw new GraphQLError("Work Item label slug is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return slug;
}

export function normalizeWorkItemDocumentKind(
  value: unknown,
): WorkItemDocumentKind {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (WORK_ITEM_DOCUMENT_KINDS.has(normalized as WorkItemDocumentKind)) {
    return normalized as WorkItemDocumentKind;
  }
  throw new GraphQLError(`Unsupported Work Item document kind: ${value}`, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

function normalizeDocumentContent(value: unknown) {
  if (value === undefined || value === null) {
    throw new GraphQLError("content or contentBase64 is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return String(value);
}

function normalizeDocumentContentType(value: unknown) {
  const contentType = optionalTrim(value) ?? "text/markdown";
  if (isSupportedDocumentContentType(contentType)) {
    return contentType;
  }
  throw new GraphQLError(
    `Unsupported Work Item document content type: ${contentType}`,
    {
      extensions: { code: "BAD_USER_INPUT" },
    },
  );
}

function resolveCreateDocumentPayload(input: Record<string, any>) {
  const contentType = normalizeDocumentContentType(input.contentType);
  if (input.contentBase64 !== undefined && input.contentBase64 !== null) {
    const buffer = decodeBase64Content(input.contentBase64);
    return {
      buffer,
      contentType,
      previewContent: isPreviewableContentType(contentType)
        ? buffer.toString("utf8")
        : null,
    };
  }
  const content = normalizeDocumentContent(input.content);
  return {
    buffer: Buffer.from(content, "utf8"),
    contentType,
    previewContent: content,
  };
}

function resolveExistingDocumentPayload(
  buffer: Buffer,
  contentTypeValue: unknown,
) {
  const contentType = normalizeDocumentContentType(contentTypeValue);
  return {
    buffer,
    contentType,
    previewContent: isPreviewableContentType(contentType)
      ? buffer.toString("utf8")
      : null,
  };
}

function decodeBase64Content(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new GraphQLError("contentBase64 is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  if (!isValidBase64(text)) {
    throw new GraphQLError("contentBase64 must be valid base64", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const buffer = Buffer.from(text, "base64");
  if (buffer.byteLength === 0) {
    throw new GraphQLError("Uploaded document is empty", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return buffer;
}

function isValidBase64(value: string) {
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
    value,
  );
}

function isSupportedDocumentContentType(contentType: string) {
  return (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/pdf" ||
    contentType === "application/csv" ||
    contentType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    contentType === "application/msword" ||
    contentType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    contentType === "application/vnd.ms-excel" ||
    contentType === "application/octet-stream"
  );
}

function isPreviewableContentType(contentType: unknown) {
  const normalized = String(contentType ?? "").toLowerCase();
  return normalized.startsWith("text/") || normalized === "application/json";
}

function validateDocumentSize(buffer: Buffer) {
  if (buffer.byteLength > MAX_WORK_ITEM_DOCUMENT_BYTES) {
    throw new GraphQLError("Work Item document exceeds the 2 MB limit", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function buildWorkItemDocumentS3Key(
  tenantId: string,
  workItemId: string,
  documentId: string,
  contentType: string,
  filename?: unknown,
) {
  const extension =
    extensionFromFilename(filename) ?? extensionFromContentType(contentType);
  return [
    "tenants",
    tenantId,
    "work-items",
    workItemId,
    "documents",
    `${documentId}.${extension}`,
  ].join("/");
}

function extensionFromFilename(value: unknown) {
  const filename = optionalTrim(value);
  if (!filename) return null;
  const match = filename.toLowerCase().match(/\.([a-z0-9]{1,12})$/);
  return match ? match[1] : null;
}

function extensionFromContentType(contentType: string) {
  switch (contentType) {
    case "application/json":
      return "json";
    case "application/pdf":
      return "pdf";
    case "text/plain":
      return "txt";
    case "text/csv":
    case "application/csv":
      return "csv";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "application/msword":
      return "doc";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return "xlsx";
    case "application/vnd.ms-excel":
      return "xls";
    default:
      return "md";
  }
}

function documentMetadata(input: Record<string, any>) {
  const parsed = parseAwsJsonObject(input.metadata);
  const filename = optionalTrim(input.filename);
  if (!filename) return parsed;
  return {
    ...(parsed && typeof parsed === "object" ? parsed : {}),
    filename,
  };
}

async function putWorkItemDocumentContent(input: {
  s3Key: string;
  contentType: string;
  body: Buffer;
  tenantId: string;
  workItemId: string;
  documentId: string;
}) {
  await workItemDocumentS3.send(
    new PutObjectCommand({
      Bucket: requireWorkspaceBucket(),
      Key: input.s3Key,
      Body: input.body,
      ContentType: input.contentType,
      Metadata: {
        tenantId: input.tenantId,
        workItemId: input.workItemId,
        documentId: input.documentId,
      },
    }),
  );
}

async function hydrateWorkItemDocumentContent(row: Record<string, any>) {
  return {
    ...row,
    content:
      row.archived_at || !isPreviewableContentType(row.content_type)
        ? null
        : await readWorkItemDocumentContent(row.s3_key),
  };
}

async function readWorkItemDocumentContent(s3Key: string) {
  return (await readWorkItemDocumentContentBuffer(s3Key)).toString("utf8");
}

async function readWorkItemDocumentContentBuffer(s3Key: string) {
  const response = await workItemDocumentS3.send(
    new GetObjectCommand({
      Bucket: requireWorkspaceBucket(),
      Key: s3Key,
    }),
  );
  return bodyToBuffer(response.Body);
}

async function bodyToBuffer(body: unknown) {
  if (!body) return Buffer.alloc(0);
  if (
    typeof body === "object" &&
    "transformToByteArray" in body &&
    typeof body.transformToByteArray === "function"
  ) {
    return Buffer.from(await body.transformToByteArray());
  }
  if (
    typeof body === "object" &&
    "transformToString" in body &&
    typeof body.transformToString === "function"
  ) {
    return Buffer.from(await body.transformToString(), "utf8");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function requireWorkspaceBucket() {
  const bucket = getConfig("WORKSPACE_BUCKET");
  if (!bucket) {
    throw new GraphQLError("WORKSPACE_BUCKET is not configured", {
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  }
  return bucket;
}

function compactObject(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  );
}
