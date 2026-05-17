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
  return db.transaction(async (tx) => {
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
        .set({ status: "applied", updated_at: now })
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

    await tx.insert(ontologyReprocessJobs).values({
      tenant_id: args.tenantId,
      change_set_id: current.id,
      ontology_version_id: version.id,
      dedupe_key: `ontology:${args.tenantId}:${current.id}:${version.id}`,
      status: "pending",
      input: {
        changeSetId: current.id,
        ontologyVersionId: version.id,
        approvedItemIds,
      },
      impact: {},
      metrics: {},
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
      },
    });

    return loadOntologyChangeSet({
      tenantId: args.tenantId,
      changeSetId: current.id,
      db: tx as unknown as DbLike,
    });
  });
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
  changeSetId: string;
  metadata?: Record<string, unknown>;
}) {
  if (!args.actorUserId) return;
  await args.db.insert(activityLog).values({
    tenant_id: args.tenantId,
    actor_type: "user",
    actor_id: args.actorUserId,
    action: args.action,
    entity_type: "ontology_change_set",
    entity_id: args.changeSetId,
    metadata: args.metadata ?? {},
  });
}
