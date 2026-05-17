import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  activityLog,
  ontologyChangeSetItems,
  ontologyChangeSets,
  ontologyEntityTypes,
  ontologyEvidenceExamples,
  ontologyExternalMappings,
  ontologyFacetTemplates,
  ontologyRelationshipTypes,
  ontologyReprocessJobs,
  ontologySuggestionScanJobs,
  ontologyVersions,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import {
  enqueueOntologyReprocessJob,
  invokeOntologyReprocessJob,
  markOntologyReprocessInvokeFailed,
} from "./reprocess.js";
import {
  toOntologyChangeSet,
  toOntologyEntityType,
  toOntologyExternalMapping,
  toOntologyFacetTemplate,
  toOntologyRelationshipType,
  toOntologyReprocessJob,
  toOntologySuggestionScanJob,
  toOntologyVersion,
} from "./mappers.js";

type DbLike = typeof defaultDb;

export type OntologyChangeSetStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "rejected"
  | "applied";

export type OntologyChangeSetItemStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "applied";

export type OntologyLifecycleStatus =
  | "proposed"
  | "approved"
  | "deprecated"
  | "rejected";

const TERMINAL_CHANGE_SET_STATUSES = new Set<OntologyChangeSetStatus>([
  "approved",
  "rejected",
  "applied",
]);

export function filterMappingsForOntologyDefinitions<
  TMapping extends { subject_kind: string; subject_id: string },
>(args: {
  entityRows: Array<{ id: string }>;
  relationshipRows: Array<{ id: string }>;
  facetRows: Array<{ id: string }>;
  mappingRows: TMapping[];
}): TMapping[] {
  const approvedSubjectIds = new Set([
    ...args.entityRows.map((row) => `entity_type:${row.id}`),
    ...args.relationshipRows.map((row) => `relationship_type:${row.id}`),
    ...args.facetRows.map((row) => `facet_template:${row.id}`),
  ]);

  return args.mappingRows.filter((mapping) =>
    approvedSubjectIds.has(`${mapping.subject_kind}:${mapping.subject_id}`),
  );
}

export interface UpdateOntologyChangeSetItemInput {
  id: string;
  status?: OntologyChangeSetItemStatus | null;
  editedValue?: unknown;
}

export interface UpdateOntologyChangeSetInput {
  tenantId: string;
  changeSetId: string;
  title?: string | null;
  summary?: string | null;
  status?: OntologyChangeSetStatus | null;
  items?: UpdateOntologyChangeSetItemInput[] | null;
}

export interface UpdateOntologyEntityTypeInput {
  tenantId: string;
  entityTypeId: string;
  name?: string | null;
  description?: string | null;
  broadType?: string | null;
  aliases?: string[] | null;
  guidanceNotes?: string | null;
  lifecycleStatus?: OntologyLifecycleStatus | null;
}

export interface UpdateOntologyRelationshipTypeInput {
  tenantId: string;
  relationshipTypeId: string;
  name?: string | null;
  description?: string | null;
  inverseName?: string | null;
  sourceTypeSlugs?: string[] | null;
  targetTypeSlugs?: string[] | null;
  aliases?: string[] | null;
  guidanceNotes?: string | null;
  lifecycleStatus?: OntologyLifecycleStatus | null;
}

export async function listOntologyDefinitions(args: {
  tenantId: string;
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  const [activeVersion] = await db
    .select()
    .from(ontologyVersions)
    .where(
      and(
        eq(ontologyVersions.tenant_id, args.tenantId),
        eq(ontologyVersions.status, "active"),
      ),
    )
    .orderBy(desc(ontologyVersions.version_number))
    .limit(1);

  const entityRows = await db
    .select()
    .from(ontologyEntityTypes)
    .where(
      and(
        eq(ontologyEntityTypes.tenant_id, args.tenantId),
        eq(ontologyEntityTypes.lifecycle_status, "approved"),
      ),
    )
    .orderBy(asc(ontologyEntityTypes.slug));
  const relationshipRows = await db
    .select()
    .from(ontologyRelationshipTypes)
    .where(
      and(
        eq(ontologyRelationshipTypes.tenant_id, args.tenantId),
        eq(ontologyRelationshipTypes.lifecycle_status, "approved"),
      ),
    )
    .orderBy(asc(ontologyRelationshipTypes.slug));
  const facetRows = await db
    .select()
    .from(ontologyFacetTemplates)
    .where(
      and(
        eq(ontologyFacetTemplates.tenant_id, args.tenantId),
        eq(ontologyFacetTemplates.lifecycle_status, "approved"),
      ),
    )
    .orderBy(
      asc(ontologyFacetTemplates.position),
      asc(ontologyFacetTemplates.slug),
    );
  const mappingRows = await db
    .select()
    .from(ontologyExternalMappings)
    .where(eq(ontologyExternalMappings.tenant_id, args.tenantId))
    .orderBy(
      asc(ontologyExternalMappings.vocabulary),
      asc(ontologyExternalMappings.external_uri),
    );
  const activeMappingRows = filterMappingsForOntologyDefinitions({
    entityRows,
    relationshipRows,
    facetRows,
    mappingRows,
  });

  return {
    tenantId: args.tenantId,
    activeVersion: toOntologyVersion(activeVersion),
    entityTypes: entityRows.map((row) =>
      toOntologyEntityType(
        row,
        facetRows.filter((facet) => facet.entity_type_id === row.id),
        activeMappingRows.filter(
          (mapping) =>
            mapping.subject_kind === "entity_type" &&
            mapping.subject_id === row.id,
        ),
      ),
    ),
    relationshipTypes: relationshipRows.map((row) =>
      toOntologyRelationshipType(
        row,
        activeMappingRows.filter(
          (mapping) =>
            mapping.subject_kind === "relationship_type" &&
            mapping.subject_id === row.id,
        ),
      ),
    ),
    facetTemplates: facetRows.map(toOntologyFacetTemplate),
    externalMappings: activeMappingRows.map(toOntologyExternalMapping),
  };
}

export async function updateOntologyEntityType(args: {
  input: UpdateOntologyEntityTypeInput;
  actorUserId: string | null;
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  const now = new Date();
  const patch: Record<string, unknown> = { updated_at: now };
  if (args.input.name !== undefined && args.input.name !== null) {
    patch.name = nonBlank(args.input.name, "Entity type name");
  }
  if (args.input.description !== undefined) {
    patch.description = args.input.description;
  }
  if (args.input.broadType !== undefined && args.input.broadType !== null) {
    patch.broad_type = nonBlank(args.input.broadType, "Entity broad type");
  }
  if (args.input.aliases !== undefined && args.input.aliases !== null) {
    patch.aliases = args.input.aliases;
  }
  if (args.input.guidanceNotes !== undefined) {
    patch.guidance_notes = args.input.guidanceNotes;
  }
  Object.assign(
    patch,
    lifecyclePatch(args.input.lifecycleStatus, args.actorUserId, now),
  );

  const [updated] = await db
    .update(ontologyEntityTypes)
    .set(patch)
    .where(
      and(
        eq(ontologyEntityTypes.id, args.input.entityTypeId),
        eq(ontologyEntityTypes.tenant_id, args.input.tenantId),
      ),
    )
    .returning({ id: ontologyEntityTypes.id });
  if (!updated) throw new Error("Ontology entity type not found");

  await recordOntologyActivity({
    db,
    tenantId: args.input.tenantId,
    actorUserId: args.actorUserId,
    action: "ontology_entity_type_updated",
    entityType: "ontology_entity_type",
    entityId: updated.id,
    metadata: {
      lifecycleStatus: args.input.lifecycleStatus ?? null,
    },
  });

  return loadOntologyEntityType({
    tenantId: args.input.tenantId,
    entityTypeId: updated.id,
    db,
  });
}

export async function updateOntologyRelationshipType(args: {
  input: UpdateOntologyRelationshipTypeInput;
  actorUserId: string | null;
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  const now = new Date();
  const patch: Record<string, unknown> = { updated_at: now };
  if (args.input.name !== undefined && args.input.name !== null) {
    patch.name = nonBlank(args.input.name, "Relationship type name");
  }
  if (args.input.description !== undefined) {
    patch.description = args.input.description;
  }
  if (args.input.inverseName !== undefined) {
    patch.inverse_name = args.input.inverseName;
  }
  if (
    args.input.sourceTypeSlugs !== undefined &&
    args.input.sourceTypeSlugs !== null
  ) {
    patch.source_type_slugs = args.input.sourceTypeSlugs;
    patch.source_entity_type_id = await entityTypeIdForFirstSlug({
      db,
      tenantId: args.input.tenantId,
      slugs: args.input.sourceTypeSlugs,
      label: "Source",
    });
  }
  if (
    args.input.targetTypeSlugs !== undefined &&
    args.input.targetTypeSlugs !== null
  ) {
    patch.target_type_slugs = args.input.targetTypeSlugs;
    patch.target_entity_type_id = await entityTypeIdForFirstSlug({
      db,
      tenantId: args.input.tenantId,
      slugs: args.input.targetTypeSlugs,
      label: "Target",
    });
  }
  if (args.input.aliases !== undefined && args.input.aliases !== null) {
    patch.aliases = args.input.aliases;
  }
  if (args.input.guidanceNotes !== undefined) {
    patch.guidance_notes = args.input.guidanceNotes;
  }
  Object.assign(
    patch,
    lifecyclePatch(args.input.lifecycleStatus, args.actorUserId, now),
  );

  const [updated] = await db
    .update(ontologyRelationshipTypes)
    .set(patch)
    .where(
      and(
        eq(ontologyRelationshipTypes.id, args.input.relationshipTypeId),
        eq(ontologyRelationshipTypes.tenant_id, args.input.tenantId),
      ),
    )
    .returning({ id: ontologyRelationshipTypes.id });
  if (!updated) throw new Error("Ontology relationship type not found");

  await recordOntologyActivity({
    db,
    tenantId: args.input.tenantId,
    actorUserId: args.actorUserId,
    action: "ontology_relationship_type_updated",
    entityType: "ontology_relationship_type",
    entityId: updated.id,
    metadata: {
      lifecycleStatus: args.input.lifecycleStatus ?? null,
    },
  });

  return loadOntologyRelationshipType({
    tenantId: args.input.tenantId,
    relationshipTypeId: updated.id,
    db,
  });
}

export async function listOntologyChangeSets(args: {
  tenantId: string;
  status?: OntologyChangeSetStatus | null;
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  const conditions = [eq(ontologyChangeSets.tenant_id, args.tenantId)];
  if (args.status) conditions.push(eq(ontologyChangeSets.status, args.status));

  const rows = await db
    .select()
    .from(ontologyChangeSets)
    .where(and(...conditions))
    .orderBy(desc(ontologyChangeSets.created_at));

  return Promise.all(
    rows.map((row) =>
      loadOntologyChangeSet({
        tenantId: args.tenantId,
        changeSetId: row.id,
        db,
      }),
    ),
  );
}

export async function loadOntologyChangeSet(args: {
  tenantId: string;
  changeSetId: string;
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  const [row] = await db
    .select()
    .from(ontologyChangeSets)
    .where(
      and(
        eq(ontologyChangeSets.id, args.changeSetId),
        eq(ontologyChangeSets.tenant_id, args.tenantId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Ontology change set not found");

  const [items, evidence] = await Promise.all([
    db
      .select()
      .from(ontologyChangeSetItems)
      .where(
        and(
          eq(ontologyChangeSetItems.change_set_id, row.id),
          eq(ontologyChangeSetItems.tenant_id, args.tenantId),
        ),
      )
      .orderBy(asc(ontologyChangeSetItems.position)),
    db
      .select()
      .from(ontologyEvidenceExamples)
      .where(
        and(
          eq(ontologyEvidenceExamples.change_set_id, row.id),
          eq(ontologyEvidenceExamples.tenant_id, args.tenantId),
        ),
      )
      .orderBy(asc(ontologyEvidenceExamples.created_at)),
  ]);

  return toOntologyChangeSet(row, items, evidence);
}

export async function updateOntologyChangeSet(args: {
  input: UpdateOntologyChangeSetInput;
  actorUserId: string | null;
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  const now = new Date();

  const [current] = await db
    .select()
    .from(ontologyChangeSets)
    .where(
      and(
        eq(ontologyChangeSets.id, args.input.changeSetId),
        eq(ontologyChangeSets.tenant_id, args.input.tenantId),
      ),
    )
    .limit(1);
  if (!current) throw new Error("Ontology change set not found");
  if (
    TERMINAL_CHANGE_SET_STATUSES.has(current.status as OntologyChangeSetStatus)
  ) {
    throw new Error("Ontology change set is already terminal");
  }

  const changeSetPatch: Record<string, unknown> = { updated_at: now };
  if (args.input.title !== undefined && args.input.title !== null) {
    changeSetPatch.title = args.input.title;
  }
  if (args.input.summary !== undefined)
    changeSetPatch.summary = args.input.summary;
  if (args.input.status !== undefined && args.input.status !== null) {
    if (TERMINAL_CHANGE_SET_STATUSES.has(args.input.status)) {
      throw new Error("Use approve/reject mutations for terminal decisions");
    }
    changeSetPatch.status = args.input.status;
  }

  await db
    .update(ontologyChangeSets)
    .set(changeSetPatch)
    .where(eq(ontologyChangeSets.id, current.id));

  for (const item of args.input.items ?? []) {
    const itemPatch: Record<string, unknown> = { updated_at: now };
    if (item.status !== undefined && item.status !== null) {
      if (item.status === "applied") {
        throw new Error(
          "Change-set line items cannot be marked applied manually",
        );
      }
      itemPatch.status = item.status;
    }
    if (item.editedValue !== undefined)
      itemPatch.edited_value = item.editedValue;
    const [updatedItem] = await db
      .update(ontologyChangeSetItems)
      .set(itemPatch)
      .where(
        and(
          eq(ontologyChangeSetItems.id, item.id),
          eq(ontologyChangeSetItems.change_set_id, current.id),
          eq(ontologyChangeSetItems.tenant_id, args.input.tenantId),
        ),
      )
      .returning({ id: ontologyChangeSetItems.id });
    if (!updatedItem) throw new Error("Ontology change-set item not found");
  }

  await recordOntologyActivity({
    db,
    tenantId: args.input.tenantId,
    actorUserId: args.actorUserId,
    action: "ontology_change_set_updated",
    changeSetId: current.id,
    metadata: {
      itemCount: args.input.items?.length ?? 0,
      status: args.input.status ?? null,
    },
  });

  return loadOntologyChangeSet({
    tenantId: args.input.tenantId,
    changeSetId: current.id,
    db,
  });
}

export async function approveOntologyChangeSet(args: {
  tenantId: string;
  changeSetId: string;
  actorUserId: string | null;
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(ontologyChangeSets)
      .where(
        and(
          eq(ontologyChangeSets.id, args.changeSetId),
          eq(ontologyChangeSets.tenant_id, args.tenantId),
        ),
      )
      .limit(1);
    if (!current) throw new Error("Ontology change set not found");
    if (
      TERMINAL_CHANGE_SET_STATUSES.has(
        current.status as OntologyChangeSetStatus,
      )
    ) {
      throw new Error("Ontology change set is already terminal");
    }

    const items = await tx
      .select()
      .from(ontologyChangeSetItems)
      .where(
        and(
          eq(ontologyChangeSetItems.change_set_id, current.id),
          eq(ontologyChangeSetItems.tenant_id, args.tenantId),
        ),
      );
    const approvedItemIds = items
      .filter((item) => item.status !== "rejected")
      .map((item) => item.id);

    const [latestVersion] = await tx
      .select()
      .from(ontologyVersions)
      .where(eq(ontologyVersions.tenant_id, args.tenantId))
      .orderBy(desc(ontologyVersions.version_number))
      .limit(1);
    const nextVersionNumber = (latestVersion?.version_number ?? 0) + 1;
    const now = new Date();

    await tx
      .update(ontologyVersions)
      .set({ status: "superseded" })
      .where(
        and(
          eq(ontologyVersions.tenant_id, args.tenantId),
          eq(ontologyVersions.status, "active"),
        ),
      );

    const [version] = await tx
      .insert(ontologyVersions)
      .values({
        tenant_id: args.tenantId,
        version_number: nextVersionNumber,
        status: "active",
        source_change_set_id: current.id,
        activated_at: now,
      })
      .returning();

    if (approvedItemIds.length > 0) {
      await tx
        .update(ontologyChangeSetItems)
        .set({ status: "approved", updated_at: now })
        .where(
          and(
            eq(ontologyChangeSetItems.tenant_id, args.tenantId),
            inArray(ontologyChangeSetItems.id, approvedItemIds),
          ),
        );
    }

    await tx
      .update(ontologyChangeSetItems)
      .set({ updated_at: now })
      .where(
        and(
          eq(ontologyChangeSetItems.change_set_id, current.id),
          eq(ontologyChangeSetItems.tenant_id, args.tenantId),
        ),
      );

    await tx
      .update(ontologyChangeSets)
      .set({
        status: "approved",
        approved_by_user_id: args.actorUserId,
        approved_at: now,
        applied_version_id: version.id,
        updated_at: now,
      })
      .where(eq(ontologyChangeSets.id, current.id));

    const reprocess = await enqueueOntologyReprocessJob({
      tenantId: args.tenantId,
      changeSetId: current.id,
      ontologyVersionId: version.id,
      approvedItemIds,
      db: tx as unknown as DbLike,
    });

    await recordOntologyActivity({
      db: tx as unknown as DbLike,
      tenantId: args.tenantId,
      actorUserId: args.actorUserId,
      action: "ontology_change_set_approved",
      changeSetId: current.id,
      metadata: {
        ontologyVersionId: version.id,
        approvedItemCount: approvedItemIds.length,
        reprocessJobId: reprocess.job.id,
        reprocessJobInserted: reprocess.inserted,
      },
    });

    const changeSet = await loadOntologyChangeSet({
      tenantId: args.tenantId,
      changeSetId: current.id,
      db: tx as unknown as DbLike,
    });
    return { changeSet, reprocessJobId: reprocess.job.id };
  });
  if (result?.reprocessJobId) {
    try {
      await invokeOntologyReprocessJob({ jobId: result.reprocessJobId });
    } catch (err) {
      await markOntologyReprocessInvokeFailed({
        jobId: result.reprocessJobId,
        error: err instanceof Error ? err.message : String(err),
        db,
      });
    }
  }
  return result.changeSet;
}

export async function rejectOntologyChangeSet(args: {
  tenantId: string;
  changeSetId: string;
  actorUserId: string | null;
  reason?: string | null;
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  const now = new Date();
  const [current] = await db
    .select()
    .from(ontologyChangeSets)
    .where(
      and(
        eq(ontologyChangeSets.id, args.changeSetId),
        eq(ontologyChangeSets.tenant_id, args.tenantId),
      ),
    )
    .limit(1);
  if (!current) throw new Error("Ontology change set not found");
  if (
    TERMINAL_CHANGE_SET_STATUSES.has(current.status as OntologyChangeSetStatus)
  ) {
    throw new Error("Ontology change set is already terminal");
  }

  await db
    .update(ontologyChangeSets)
    .set({
      status: "rejected",
      rejected_by_user_id: args.actorUserId,
      rejected_at: now,
      updated_at: now,
    })
    .where(eq(ontologyChangeSets.id, current.id));
  await db
    .update(ontologyChangeSetItems)
    .set({ status: "rejected", updated_at: now })
    .where(
      and(
        eq(ontologyChangeSetItems.change_set_id, current.id),
        eq(ontologyChangeSetItems.tenant_id, args.tenantId),
      ),
    );

  await recordOntologyActivity({
    db,
    tenantId: args.tenantId,
    actorUserId: args.actorUserId,
    action: "ontology_change_set_rejected",
    changeSetId: current.id,
    metadata: { reason: args.reason ?? null },
  });

  return loadOntologyChangeSet({
    tenantId: args.tenantId,
    changeSetId: current.id,
    db,
  });
}

export async function startOntologySuggestionScan(args: {
  tenantId: string;
  trigger?: string | null;
  dedupeKey?: string | null;
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  const [job] = await db
    .insert(ontologySuggestionScanJobs)
    .values({
      tenant_id: args.tenantId,
      trigger: args.trigger || "manual",
      dedupe_key: args.dedupeKey || null,
      status: "pending",
      result: {},
      metrics: {},
    })
    .returning();
  return toOntologySuggestionScanJob(job);
}

export async function loadOntologySuggestionScanJob(args: {
  tenantId: string;
  jobId: string;
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  const [job] = await db
    .select()
    .from(ontologySuggestionScanJobs)
    .where(
      and(
        eq(ontologySuggestionScanJobs.id, args.jobId),
        eq(ontologySuggestionScanJobs.tenant_id, args.tenantId),
      ),
    )
    .limit(1);
  return job ? toOntologySuggestionScanJob(job) : null;
}

export async function loadOntologyReprocessJob(args: {
  tenantId: string;
  jobId: string;
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  const [job] = await db
    .select()
    .from(ontologyReprocessJobs)
    .where(
      and(
        eq(ontologyReprocessJobs.id, args.jobId),
        eq(ontologyReprocessJobs.tenant_id, args.tenantId),
      ),
    )
    .limit(1);
  return job ? toOntologyReprocessJob(job) : null;
}

async function recordOntologyActivity(args: {
  db: DbLike;
  tenantId: string;
  actorUserId: string | null;
  action: string;
  changeSetId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  if (!args.actorUserId) return;
  await args.db.insert(activityLog).values({
    tenant_id: args.tenantId,
    actor_type: "user",
    actor_id: args.actorUserId,
    action: args.action,
    entity_type: args.entityType ?? "ontology_change_set",
    entity_id: args.entityId ?? args.changeSetId,
    metadata: args.metadata ?? {},
  });
}

async function loadOntologyEntityType(args: {
  tenantId: string;
  entityTypeId: string;
  db: DbLike;
}) {
  const [row] = await args.db
    .select()
    .from(ontologyEntityTypes)
    .where(
      and(
        eq(ontologyEntityTypes.id, args.entityTypeId),
        eq(ontologyEntityTypes.tenant_id, args.tenantId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Ontology entity type not found");

  const [facetRows, mappingRows] = await Promise.all([
    args.db
      .select()
      .from(ontologyFacetTemplates)
      .where(
        and(
          eq(ontologyFacetTemplates.entity_type_id, row.id),
          eq(ontologyFacetTemplates.tenant_id, args.tenantId),
        ),
      )
      .orderBy(
        asc(ontologyFacetTemplates.position),
        asc(ontologyFacetTemplates.slug),
      ),
    args.db
      .select()
      .from(ontologyExternalMappings)
      .where(
        and(
          eq(ontologyExternalMappings.tenant_id, args.tenantId),
          eq(ontologyExternalMappings.subject_kind, "entity_type"),
          eq(ontologyExternalMappings.subject_id, row.id),
        ),
      ),
  ]);

  return toOntologyEntityType(row, facetRows, mappingRows);
}

async function loadOntologyRelationshipType(args: {
  tenantId: string;
  relationshipTypeId: string;
  db: DbLike;
}) {
  const [row] = await args.db
    .select()
    .from(ontologyRelationshipTypes)
    .where(
      and(
        eq(ontologyRelationshipTypes.id, args.relationshipTypeId),
        eq(ontologyRelationshipTypes.tenant_id, args.tenantId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Ontology relationship type not found");

  const mappingRows = await args.db
    .select()
    .from(ontologyExternalMappings)
    .where(
      and(
        eq(ontologyExternalMappings.tenant_id, args.tenantId),
        eq(ontologyExternalMappings.subject_kind, "relationship_type"),
        eq(ontologyExternalMappings.subject_id, row.id),
      ),
    );

  return toOntologyRelationshipType(row, mappingRows);
}

function lifecyclePatch(
  status: OntologyLifecycleStatus | null | undefined,
  actorUserId: string | null,
  now: Date,
) {
  if (!status) return {};
  const patch: Record<string, unknown> = { lifecycle_status: status };
  if (status === "approved") {
    patch.approved_at = now;
    patch.approved_by_user_id = actorUserId;
    patch.deprecated_at = null;
    patch.rejected_at = null;
  }
  if (status === "deprecated") {
    patch.deprecated_at = now;
  }
  if (status === "rejected") {
    patch.rejected_at = now;
  }
  if (status === "proposed") {
    patch.approved_at = null;
    patch.approved_by_user_id = null;
    patch.deprecated_at = null;
    patch.rejected_at = null;
  }
  return patch;
}

function nonBlank(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} cannot be blank`);
  return trimmed;
}

async function entityTypeIdForFirstSlug(args: {
  db: DbLike;
  tenantId: string;
  slugs: string[];
  label: "Source" | "Target";
}) {
  const [slug] = args.slugs;
  if (!slug) return null;
  const [row] = await args.db
    .select({ id: ontologyEntityTypes.id })
    .from(ontologyEntityTypes)
    .where(
      and(
        eq(ontologyEntityTypes.tenant_id, args.tenantId),
        eq(ontologyEntityTypes.slug, slug),
      ),
    )
    .limit(1);
  if (!row) throw new Error(`${args.label} entity type slug not found`);
  return row.id;
}
