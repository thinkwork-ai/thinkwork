import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { parseIdentityRules } from "../entity-identity/normalizers.js";
import {
  activityLog,
  kgEntities,
  ontologyCandidateRejections,
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
  | "applied"
  | "deferred";

export type OntologyExcludedItemDisposition = "deferred" | "rejected";

export type OntologyChangeItemKind =
  | "entity_type"
  | "relationship_type"
  | "facet_template"
  | "external_mapping"
  | "identity_map";

/**
 * Concurrency/settlement conflict on a change-set item (THINK-320 R16):
 * either the item changed since the client loaded it (stale
 * expectedUpdatedAt) or it is already settled (approved/applied). Nothing
 * was written when this is thrown.
 */
export class OntologyChangeSetConflictError extends Error {
  readonly code = "ONTOLOGY_CHANGE_SET_CONFLICT";

  constructor(
    message: string,
    readonly itemId?: string,
    readonly currentUpdatedAt?: string,
  ) {
    super(message);
    this.name = "OntologyChangeSetConflictError";
  }
}

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
  /**
   * Optimistic concurrency guard (THINK-320 R16): the item's updated_at as
   * loaded by the client. Mismatch raises OntologyChangeSetConflictError
   * before anything is written; omit to skip the check.
   */
  expectedUpdatedAt?: string | null;
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

/**
 * Change-set statuses whose items are still reviewable — the candidate
 * supply for the Living Map (THINK-320 U1). Approved/rejected/applied
 * sets are settled and never surface candidates.
 */
const PENDING_CANDIDATE_CHANGE_SET_STATUSES: OntologyChangeSetStatus[] = [
  "draft",
  "pending_review",
];

const graphEnumValue = (value: string | null | undefined) =>
  value ? value.toUpperCase() : value;

/**
 * Pure assembly for the Living Map schema graph (THINK-320 U1): approved
 * types with live instance counts, approved relationships, and pending
 * change-set items as candidates. Split from getOntologySchemaGraph so
 * count merging and candidate filtering are unit-testable without a DB.
 */
export function assembleOntologySchemaGraph(args: {
  tenantId: string;
  entityRows: Array<{ slug: string; name: string; lifecycle_status: string }>;
  relationshipRows: Array<{
    slug: string;
    name: string;
    source_type_slugs: string[] | null;
    target_type_slugs: string[] | null;
  }>;
  instanceCountRows: Array<{ slug: string | null; count: number }>;
  changeSetRows: Array<{ id: string; status: string; proposed_by: string }>;
  candidateItemRows: Array<{
    id: string;
    change_set_id: string;
    item_type: string;
    status: string;
    target_slug: string | null;
    proposed_value: unknown;
    edited_value: unknown;
  }>;
  evidenceCountRows: Array<{ itemId: string | null; count: number }>;
}) {
  const countBySlug = new Map<string, number>();
  for (const row of args.instanceCountRows) {
    if (row.slug) countBySlug.set(row.slug, Number(row.count));
  }
  const changeSetById = new Map(args.changeSetRows.map((row) => [row.id, row]));
  const evidenceCountByItemId = new Map<string, number>();
  for (const row of args.evidenceCountRows) {
    if (row.itemId) evidenceCountByItemId.set(row.itemId, Number(row.count));
  }

  return {
    tenantId: args.tenantId,
    types: args.entityRows.map((row) => ({
      slug: row.slug,
      name: row.name,
      instanceCount: countBySlug.get(row.slug) ?? 0,
      lifecycleStatus: graphEnumValue(row.lifecycle_status),
    })),
    relationships: args.relationshipRows.map((row) => ({
      slug: row.slug,
      name: row.name,
      sourceTypeSlugs: row.source_type_slugs ?? [],
      targetTypeSlugs: row.target_type_slugs ?? [],
    })),
    candidates: args.candidateItemRows
      .filter(
        (item) =>
          // Only still-reviewable items in still-open change sets count as
          // candidates — approved/rejected items are settled, not ghosts.
          item.status === "pending_review" &&
          changeSetById.has(item.change_set_id),
      )
      .map((item) => {
        const proposedValue = (item.proposed_value ?? {}) as Record<
          string,
          unknown
        >;
        const proposedSlug =
          typeof proposedValue.slug === "string" ? proposedValue.slug : null;
        return {
          itemId: item.id,
          changeSetId: item.change_set_id,
          itemType: graphEnumValue(item.item_type),
          slug: item.target_slug ?? proposedSlug,
          proposedValue,
          editedValue: item.edited_value,
          evidenceCount: evidenceCountByItemId.get(item.id) ?? 0,
          origin: changeSetById.get(item.change_set_id)?.proposed_by ?? "",
          status: graphEnumValue(item.status),
        };
      }),
  };
}

export async function getOntologySchemaGraph(args: {
  tenantId: string;
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  const [entityRows, relationshipRows, instanceCountRows, changeSetRows] =
    await Promise.all([
      db
        .select()
        .from(ontologyEntityTypes)
        .where(
          and(
            eq(ontologyEntityTypes.tenant_id, args.tenantId),
            eq(ontologyEntityTypes.lifecycle_status, "approved"),
          ),
        )
        .orderBy(asc(ontologyEntityTypes.slug)),
      db
        .select()
        .from(ontologyRelationshipTypes)
        .where(
          and(
            eq(ontologyRelationshipTypes.tenant_id, args.tenantId),
            eq(ontologyRelationshipTypes.lifecycle_status, "approved"),
          ),
        )
        .orderBy(asc(ontologyRelationshipTypes.slug)),
      db
        .select({
          slug: kgEntities.ontology_type_slug,
          count: sql<number>`count(*)::int`,
        })
        .from(kgEntities)
        .where(
          and(
            eq(kgEntities.tenant_id, args.tenantId),
            isNotNull(kgEntities.ontology_type_slug),
          ),
        )
        .groupBy(kgEntities.ontology_type_slug),
      db
        .select()
        .from(ontologyChangeSets)
        .where(
          and(
            eq(ontologyChangeSets.tenant_id, args.tenantId),
            inArray(
              ontologyChangeSets.status,
              PENDING_CANDIDATE_CHANGE_SET_STATUSES,
            ),
          ),
        )
        .orderBy(desc(ontologyChangeSets.created_at)),
    ]);

  const changeSetIds = changeSetRows.map((row) => row.id);
  const candidateItemRows =
    changeSetIds.length > 0
      ? await db
          .select()
          .from(ontologyChangeSetItems)
          .where(
            and(
              eq(ontologyChangeSetItems.tenant_id, args.tenantId),
              inArray(ontologyChangeSetItems.change_set_id, changeSetIds),
            ),
          )
          .orderBy(asc(ontologyChangeSetItems.position))
      : [];
  const itemIds = candidateItemRows.map((row) => row.id);
  const evidenceCountRows =
    itemIds.length > 0
      ? await db
          .select({
            itemId: ontologyEvidenceExamples.item_id,
            count: sql<number>`count(*)::int`,
          })
          .from(ontologyEvidenceExamples)
          .where(
            and(
              eq(ontologyEvidenceExamples.tenant_id, args.tenantId),
              inArray(ontologyEvidenceExamples.item_id, itemIds),
            ),
          )
          .groupBy(ontologyEvidenceExamples.item_id)
      : [];

  return assembleOntologySchemaGraph({
    tenantId: args.tenantId,
    entityRows,
    relationshipRows,
    instanceCountRows,
    changeSetRows,
    candidateItemRows,
    evidenceCountRows,
  });
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

/**
 * Replace an entity type's identity rules (THINK-193 U4). Validated via
 * parseIdentityRules (malformed entries drop); bumps identity_rules_version
 * so the matcher/audit can pin which rule set produced a link.
 */
export async function setOntologyEntityTypeIdentityRules(args: {
  tenantId: string;
  entityTypeId: string;
  rules: unknown;
  actorUserId: string | null;
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  const parsed = parseIdentityRules(args.rules);
  const now = new Date();
  const [updated] = await db
    .update(ontologyEntityTypes)
    .set({
      identity_rules: parsed as unknown as Array<Record<string, unknown>>,
      identity_rules_version: sql`${ontologyEntityTypes.identity_rules_version} + 1`,
      updated_at: now,
    })
    .where(
      and(
        eq(ontologyEntityTypes.id, args.entityTypeId),
        eq(ontologyEntityTypes.tenant_id, args.tenantId),
      ),
    )
    .returning({ id: ontologyEntityTypes.id });
  if (!updated) throw new Error("Ontology entity type not found");

  await recordOntologyActivity({
    db,
    tenantId: args.tenantId,
    actorUserId: args.actorUserId,
    action: "ontology_entity_type_identity_rules_updated",
    entityType: "ontology_entity_type",
    entityId: updated.id,
    metadata: { ruleCount: parsed.length },
  });

  return loadOntologyEntityType({
    tenantId: args.tenantId,
    entityTypeId: updated.id,
    db,
  });
}

export interface OntologySystemMapEntry {
  facet: string;
  sourceSystem: string;
  note?: string;
}

/**
 * Parse a type-level system map (THINK-321 U3 / KTD-3). Mirrors
 * parseIdentityRules: malformed entries drop silently rather than failing
 * the whole submission.
 */
export function parseOntologySystemMap(raw: unknown): OntologySystemMapEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: OntologySystemMapEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const facet =
      typeof candidate.facet === "string" ? candidate.facet.trim() : "";
    const sourceSystem =
      typeof candidate.sourceSystem === "string"
        ? candidate.sourceSystem.trim()
        : "";
    if (!facet || !sourceSystem) continue;
    entries.push({
      facet,
      sourceSystem,
      ...(typeof candidate.note === "string" && candidate.note.trim()
        ? { note: candidate.note.trim() }
        : {}),
    });
  }
  return entries;
}

/**
 * Stage a type-level system-map edit as a DRAFT `identity_map` change-set
 * item (THINK-321 U3 / R6). Never writes entity_types directly — the map
 * only lands via applyIdentityMapItem when the change set is approved and
 * applied. Draft-append semantics come from createOntologyChangeSet: a
 * second submission for the same entity type merges into the pending item
 * (R14) instead of duplicating it.
 */
export async function stageOntologyEntityTypeSystemMap(args: {
  tenantId: string;
  entityTypeSlug: string;
  systemMap: unknown;
  actorUserId: string | null;
  db?: DbLike;
}) {
  const slug = normalizeOntologySlug(args.entityTypeSlug);
  if (!slug) throw new Error("Entity type slug required");
  const entries = parseOntologySystemMap(args.systemMap);
  return createOntologyChangeSet({
    tenantId: args.tenantId,
    actorUserId: args.actorUserId,
    items: [
      {
        itemType: "identity_map",
        action: "update",
        slug,
        title: `System map for ${slug.replace(/_/g, " ")}`,
        proposedValue: {
          entityTypeSlug: slug,
          systemMap: entries as unknown as Array<Record<string, unknown>>,
        },
      },
    ],
    db: args.db,
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

const OPEN_CHANGE_SET_STATUSES: OntologyChangeSetStatus[] = [
  "draft",
  "pending_review",
];

/** Item statuses a new proposal may merge into (R14): still-reviewable. */
const MERGEABLE_ITEM_STATUSES = ["pending_review", "deferred"];

const normalizeOntologySlug = (slug: string) =>
  slug.trim().toLowerCase().replace(/\s+/g, "_");

/**
 * Deterministic rejection fingerprint (THINK-320 R13/KTD-6): normalized
 * `kind:slug`. Written to ontology.candidate_rejections and consulted by
 * the suggestion pipeline so rejected candidates are never re-proposed.
 */
export function ontologyCandidateFingerprint(kind: string, slug: string) {
  return `${kind.trim().toLowerCase()}:${normalizeOntologySlug(slug)}`;
}

export interface OntologyChangeSetItemEvidenceInput {
  sourceKind: string;
  sourceRef?: string | null;
  sourceLabel?: string | null;
  quote: string;
  metadata?: Record<string, unknown> | null;
  observedAt?: string | null;
}

export interface CreateOntologyChangeSetItemInput {
  itemType: OntologyChangeItemKind;
  action?: "create" | "update" | "deprecate" | "reject" | null;
  slug: string;
  title?: string | null;
  description?: string | null;
  proposedValue?: Record<string, unknown> | null;
  confidence?: number | null;
  evidence?: OntologyChangeSetItemEvidenceInput[] | null;
}

export interface OntologyChangeSetSlugConflict {
  slug: string;
  itemType: OntologyChangeItemKind;
  reason: "approved_definition";
}

/**
 * Pure R14 slug-collision planner (THINK-320 U2). Splits submitted items
 * into inserts (fresh slugs), merges (slug matches a still-reviewable
 * pending item — evidence unions, proposal updates in place), and
 * conflicts (slug already approved — never a silent duplicate). Duplicate
 * slugs inside one submission collapse into a single staged item.
 */
export function planOntologyChangeSetItemWrites(args: {
  items: CreateOntologyChangeSetItemInput[];
  pendingItems: Array<{
    id: string;
    change_set_id: string;
    item_type: string;
    target_slug: string | null;
    proposed_value: unknown;
  }>;
  approvedFingerprints: Set<string>;
}) {
  const pendingByFingerprint = new Map<
    string,
    (typeof args.pendingItems)[number]
  >();
  for (const pending of args.pendingItems) {
    const proposed = (pending.proposed_value ?? {}) as Record<string, unknown>;
    const rawSlug =
      pending.target_slug ??
      (typeof proposed.slug === "string" ? proposed.slug : null);
    if (!rawSlug) continue;
    const fingerprint = ontologyCandidateFingerprint(
      pending.item_type,
      rawSlug,
    );
    if (!pendingByFingerprint.has(fingerprint)) {
      pendingByFingerprint.set(fingerprint, pending);
    }
  }

  const inserts: Array<
    CreateOntologyChangeSetItemInput & {
      slug: string;
      evidence: OntologyChangeSetItemEvidenceInput[];
    }
  > = [];
  const insertByFingerprint = new Map<string, (typeof inserts)[number]>();
  const merges: Array<{
    itemId: string;
    changeSetId: string;
    proposedValue: Record<string, unknown>;
    evidence: OntologyChangeSetItemEvidenceInput[];
  }> = [];
  const mergeByFingerprint = new Map<string, (typeof merges)[number]>();
  const conflicts: OntologyChangeSetSlugConflict[] = [];

  for (const item of args.items) {
    const slug = normalizeOntologySlug(item.slug);
    const fingerprint = ontologyCandidateFingerprint(item.itemType, item.slug);
    const proposedValue = (item.proposedValue ?? {}) as Record<string, unknown>;
    const evidence = item.evidence ?? [];

    if (args.approvedFingerprints.has(fingerprint)) {
      conflicts.push({
        slug,
        itemType: item.itemType,
        reason: "approved_definition",
      });
      continue;
    }

    const pending = pendingByFingerprint.get(fingerprint);
    if (pending) {
      const existingMerge = mergeByFingerprint.get(fingerprint);
      if (existingMerge) {
        existingMerge.proposedValue = proposedValue;
        existingMerge.evidence.push(...evidence);
      } else {
        const merge = {
          itemId: pending.id,
          changeSetId: pending.change_set_id,
          proposedValue,
          evidence: [...evidence],
        };
        merges.push(merge);
        mergeByFingerprint.set(fingerprint, merge);
      }
      continue;
    }

    const existingInsert = insertByFingerprint.get(fingerprint);
    if (existingInsert) {
      existingInsert.proposedValue = proposedValue;
      existingInsert.evidence.push(...evidence);
      continue;
    }
    const insert = { ...item, slug, evidence: [...evidence] };
    inserts.push(insert);
    insertByFingerprint.set(fingerprint, insert);
  }

  return { inserts, merges, conflicts };
}

/**
 * Pure R15 approval partitioner with the AE7 dependency check. Items that
 * are rejected, deferred, or explicitly excluded are never approved; a
 * relationship item being approved whose referenced source/target type
 * slug belongs to a type item in the same set that is NOT being approved
 * (and is not already an approved definition) blocks the approval with an
 * error naming the excluded type.
 */
export function partitionOntologyApprovalItems(args: {
  items: Array<{
    id: string;
    item_type: string;
    status: string;
    target_slug: string | null;
    proposed_value: unknown;
    edited_value: unknown;
  }>;
  excludedItemIds?: string[] | null;
  approvedDefinitionTypeSlugs?: Set<string>;
}) {
  const excluded = new Set(args.excludedItemIds ?? []);
  const itemIds = new Set(args.items.map((item) => item.id));
  for (const id of excluded) {
    if (!itemIds.has(id)) {
      throw new Error(`Excluded item ${id} is not part of this change set`);
    }
  }

  const slugOf = (item: (typeof args.items)[number]) => {
    const proposed = (item.proposed_value ?? {}) as Record<string, unknown>;
    const raw =
      item.target_slug ??
      (typeof proposed.slug === "string" ? proposed.slug : null);
    return raw ? normalizeOntologySlug(raw) : null;
  };

  const isApproving = (item: (typeof args.items)[number]) =>
    item.status !== "rejected" &&
    item.status !== "deferred" &&
    !excluded.has(item.id);

  const approving = args.items.filter(isApproving);
  const approvingTypeSlugs = new Set(
    approving
      .filter((item) => item.item_type === "entity_type")
      .map(slugOf)
      .filter((slug): slug is string => slug !== null),
  );
  const nonApprovingTypeSlugs = new Set(
    args.items
      .filter((item) => item.item_type === "entity_type" && !isApproving(item))
      .map(slugOf)
      .filter((slug): slug is string => slug !== null),
  );

  for (const relationship of approving) {
    if (relationship.item_type !== "relationship_type") continue;
    const effective = (relationship.edited_value ??
      relationship.proposed_value ??
      {}) as Record<string, unknown>;
    const referenced = [
      ...((effective.sourceTypeSlugs as string[] | undefined) ?? []),
      ...((effective.targetTypeSlugs as string[] | undefined) ?? []),
    ].map(normalizeOntologySlug);
    for (const ref of referenced) {
      if (approvingTypeSlugs.has(ref)) continue;
      if (args.approvedDefinitionTypeSlugs?.has(ref)) continue;
      if (nonApprovingTypeSlugs.has(ref)) {
        throw new Error(
          `Cannot approve relationship "${slugOf(relationship) ?? relationship.id}": its referenced type "${ref}" is excluded from this approval`,
        );
      }
    }
  }

  return {
    approveIds: approving.map((item) => item.id),
    excludeIds: args.items
      .filter((item) => excluded.has(item.id))
      .map((item) => item.id),
  };
}

/**
 * Pure R16 edit guard: settled items (approved/applied) reject edits, and
 * a client-supplied expectedUpdatedAt that no longer matches the stored
 * timestamp raises a conflict instead of silently overwriting.
 */
export function guardOntologyChangeSetItemEdit(args: {
  row: { id: string; status: string; updated_at: Date | string };
  expectedUpdatedAt?: string | null;
}) {
  const current =
    args.row.updated_at instanceof Date
      ? args.row.updated_at
      : new Date(args.row.updated_at);
  if (args.row.status === "approved" || args.row.status === "applied") {
    throw new OntologyChangeSetConflictError(
      `Ontology change-set item ${args.row.id} is settled (${args.row.status}) and no longer accepts edits`,
      args.row.id,
      current.toISOString(),
    );
  }
  if (args.expectedUpdatedAt) {
    const expected = new Date(args.expectedUpdatedAt);
    if (expected.getTime() !== current.getTime()) {
      throw new OntologyChangeSetConflictError(
        `Ontology change-set item ${args.row.id} changed since it was loaded — reload before editing`,
        args.row.id,
        current.toISOString(),
      );
    }
  }
}

async function insertOntologyCandidateRejections(args: {
  db: DbLike;
  tenantId: string;
  actorUserId: string | null;
  items: Array<{
    item_type: string;
    target_slug: string | null;
    proposed_value: unknown;
  }>;
  now: Date;
}) {
  const values = args.items.flatMap((item) => {
    const proposed = (item.proposed_value ?? {}) as Record<string, unknown>;
    const rawSlug =
      item.target_slug ??
      (typeof proposed.slug === "string" ? proposed.slug : null);
    if (!rawSlug) return [];
    return [
      {
        tenant_id: args.tenantId,
        kind: item.item_type,
        slug: normalizeOntologySlug(rawSlug),
        fingerprint: ontologyCandidateFingerprint(item.item_type, rawSlug),
        rejected_by: args.actorUserId,
        rejected_at: args.now,
      },
    ];
  });
  if (values.length === 0) return;
  await args.db
    .insert(ontologyCandidateRejections)
    .values(values)
    .onConflictDoNothing();
}

/**
 * Manual authoring entry point (THINK-320 U2, KTD-5 / R7 / R8 / R14).
 * Creates or appends to the caller's open manual draft (one open
 * proposed_by='user' change set per admin), running the R14 slug-collision
 * check per item: colliding pending slugs merge into the existing item
 * (evidence unioned, proposal updated), colliding approved slugs come back
 * as conflicts with no row written. Never touches ontology versions —
 * approval stays a distinct action (AE1).
 */
export async function createOntologyChangeSet(args: {
  tenantId: string;
  actorUserId: string | null;
  title?: string | null;
  summary?: string | null;
  items: CreateOntologyChangeSetItemInput[];
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as DbLike;
    const openSets = await tx
      .select()
      .from(ontologyChangeSets)
      .where(
        and(
          eq(ontologyChangeSets.tenant_id, args.tenantId),
          inArray(ontologyChangeSets.status, OPEN_CHANGE_SET_STATUSES),
        ),
      )
      .orderBy(desc(ontologyChangeSets.created_at));
    const openSetIds = openSets.map((row) => row.id);

    const pendingItems =
      openSetIds.length > 0
        ? await tx
            .select()
            .from(ontologyChangeSetItems)
            .where(
              and(
                eq(ontologyChangeSetItems.tenant_id, args.tenantId),
                inArray(ontologyChangeSetItems.change_set_id, openSetIds),
                inArray(ontologyChangeSetItems.status, MERGEABLE_ITEM_STATUSES),
              ),
            )
        : [];

    const [entitySlugRows, relationshipSlugRows, facetSlugRows] =
      await Promise.all([
        tx
          .select({ slug: ontologyEntityTypes.slug })
          .from(ontologyEntityTypes)
          .where(
            and(
              eq(ontologyEntityTypes.tenant_id, args.tenantId),
              eq(ontologyEntityTypes.lifecycle_status, "approved"),
            ),
          ),
        tx
          .select({ slug: ontologyRelationshipTypes.slug })
          .from(ontologyRelationshipTypes)
          .where(
            and(
              eq(ontologyRelationshipTypes.tenant_id, args.tenantId),
              eq(ontologyRelationshipTypes.lifecycle_status, "approved"),
            ),
          ),
        tx
          .select({ slug: ontologyFacetTemplates.slug })
          .from(ontologyFacetTemplates)
          .where(
            and(
              eq(ontologyFacetTemplates.tenant_id, args.tenantId),
              eq(ontologyFacetTemplates.lifecycle_status, "approved"),
            ),
          ),
      ]);
    const approvedFingerprints = new Set<string>([
      ...entitySlugRows.map((row) =>
        ontologyCandidateFingerprint("entity_type", row.slug),
      ),
      ...relationshipSlugRows.map((row) =>
        ontologyCandidateFingerprint("relationship_type", row.slug),
      ),
      ...facetSlugRows.map((row) =>
        ontologyCandidateFingerprint("facet_template", row.slug),
      ),
    ]);

    const plan = planOntologyChangeSetItemWrites({
      items: args.items,
      pendingItems,
      approvedFingerprints,
    });
    const now = new Date();

    let draft =
      openSets.find(
        (row) =>
          row.proposed_by === "user" &&
          (args.actorUserId
            ? row.proposed_by_user_id === args.actorUserId
            : row.proposed_by_user_id === null),
      ) ?? null;
    if (!draft && plan.inserts.length > 0) {
      const [inserted] = await tx
        .insert(ontologyChangeSets)
        .values({
          tenant_id: args.tenantId,
          title: args.title?.trim() || "Manual ontology draft",
          summary: args.summary ?? null,
          status: "draft",
          proposed_by: "user",
          proposed_by_user_id: args.actorUserId,
          expected_impact: {},
        })
        .returning();
      draft = inserted;
    }

    const insertEvidence = async (
      changeSetId: string,
      itemId: string,
      evidence: OntologyChangeSetItemEvidenceInput[],
    ) => {
      if (evidence.length === 0) return;
      await tx.insert(ontologyEvidenceExamples).values(
        evidence.map((entry) => ({
          tenant_id: args.tenantId,
          change_set_id: changeSetId,
          item_id: itemId,
          source_kind: entry.sourceKind,
          source_ref: entry.sourceRef ?? null,
          source_label: entry.sourceLabel ?? null,
          quote: entry.quote,
          metadata: entry.metadata ?? {},
          observed_at: entry.observedAt ? new Date(entry.observedAt) : null,
        })),
      );
    };

    const mergedItemIds: string[] = [];
    for (const merge of plan.merges) {
      await tx
        .update(ontologyChangeSetItems)
        .set({
          proposed_value: merge.proposedValue,
          status: "pending_review",
          updated_at: now,
        })
        .where(
          and(
            eq(ontologyChangeSetItems.id, merge.itemId),
            eq(ontologyChangeSetItems.tenant_id, args.tenantId),
          ),
        );
      await insertEvidence(merge.changeSetId, merge.itemId, merge.evidence);
      mergedItemIds.push(merge.itemId);
    }

    if (draft && plan.inserts.length > 0) {
      let position = pendingItems
        .filter((item) => item.change_set_id === draft.id)
        .reduce((max, item) => Math.max(max, (item.position ?? 0) + 1), 0);
      for (const insert of plan.inserts) {
        const [itemRow] = await tx
          .insert(ontologyChangeSetItems)
          .values({
            tenant_id: args.tenantId,
            change_set_id: draft.id,
            item_type: insert.itemType,
            action: insert.action ?? "create",
            status: "pending_review",
            target_kind: insert.itemType,
            target_slug: insert.slug,
            title:
              insert.title?.trim() || `Add ${insert.slug.replace(/_/g, " ")}`,
            description: insert.description ?? null,
            proposed_value: {
              ...(insert.proposedValue ?? {}),
              slug: insert.slug,
            },
            confidence:
              insert.confidence === null || insert.confidence === undefined
                ? null
                : String(insert.confidence),
            position,
          })
          .returning();
        position += 1;
        await insertEvidence(draft.id, itemRow.id, insert.evidence);
      }
    }

    if (draft) {
      await recordOntologyActivity({
        db: tx,
        tenantId: args.tenantId,
        actorUserId: args.actorUserId,
        action: "ontology_change_set_items_authored",
        changeSetId: draft.id,
        metadata: {
          insertedCount: plan.inserts.length,
          mergedCount: mergedItemIds.length,
          conflictCount: plan.conflicts.length,
        },
      });
    }

    const changeSet = draft
      ? await loadOntologyChangeSet({
          tenantId: args.tenantId,
          changeSetId: draft.id,
          db: tx,
        })
      : null;
    return { changeSet, mergedItemIds, conflicts: plan.conflicts };
  });
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

  // R16: validate every item edit (existence, settlement, optimistic
  // concurrency) BEFORE any write so a conflict leaves nothing behind.
  const itemInputs = args.input.items ?? [];
  if (itemInputs.length > 0) {
    const itemRows = await db
      .select()
      .from(ontologyChangeSetItems)
      .where(
        and(
          eq(ontologyChangeSetItems.change_set_id, current.id),
          eq(ontologyChangeSetItems.tenant_id, args.input.tenantId),
        ),
      );
    const rowById = new Map(itemRows.map((row) => [row.id, row]));
    for (const item of itemInputs) {
      const row = rowById.get(item.id);
      if (!row) throw new Error("Ontology change-set item not found");
      if (item.status === "applied") {
        throw new Error(
          "Change-set line items cannot be marked applied manually",
        );
      }
      guardOntologyChangeSetItemEdit({
        row,
        expectedUpdatedAt: item.expectedUpdatedAt,
      });
    }
  }

  await db
    .update(ontologyChangeSets)
    .set(changeSetPatch)
    .where(eq(ontologyChangeSets.id, current.id));

  for (const item of itemInputs) {
    const itemPatch: Record<string, unknown> = { updated_at: now };
    if (item.status !== undefined && item.status !== null) {
      itemPatch.status = item.status;
    }
    if (item.editedValue !== undefined)
      itemPatch.edited_value = item.editedValue;
    await db
      .update(ontologyChangeSetItems)
      .set(itemPatch)
      .where(
        and(
          eq(ontologyChangeSetItems.id, item.id),
          eq(ontologyChangeSetItems.change_set_id, current.id),
          eq(ontologyChangeSetItems.tenant_id, args.input.tenantId),
        ),
      );
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
  /**
   * Per-item approval (THINK-320 R15/KTD-7): items to exclude from this
   * approval. Excluded items become `deferred` (re-reviewable) or
   * `rejected` (fingerprinted per R13) per excludedDisposition.
   */
  excludedItemIds?: string[] | null;
  excludedDisposition?: OntologyExcludedItemDisposition | null;
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
    const approvedTypeRows = await tx
      .select({ slug: ontologyEntityTypes.slug })
      .from(ontologyEntityTypes)
      .where(
        and(
          eq(ontologyEntityTypes.tenant_id, args.tenantId),
          eq(ontologyEntityTypes.lifecycle_status, "approved"),
        ),
      );
    const { approveIds: approvedItemIds, excludeIds } =
      partitionOntologyApprovalItems({
        items,
        excludedItemIds: args.excludedItemIds ?? [],
        approvedDefinitionTypeSlugs: new Set(
          approvedTypeRows.map((row) => row.slug),
        ),
      });

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

    const excludedDisposition = args.excludedDisposition ?? "deferred";
    if (excludeIds.length > 0) {
      await tx
        .update(ontologyChangeSetItems)
        .set({ status: excludedDisposition, updated_at: now })
        .where(
          and(
            eq(ontologyChangeSetItems.tenant_id, args.tenantId),
            inArray(ontologyChangeSetItems.id, excludeIds),
          ),
        );
      if (excludedDisposition === "rejected") {
        await insertOntologyCandidateRejections({
          db: tx as unknown as DbLike,
          tenantId: args.tenantId,
          actorUserId: args.actorUserId,
          items: items.filter((item) => excludeIds.includes(item.id)),
          now,
        });
      }
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
        excludedItemCount: excludeIds.length,
        excludedDisposition: excludeIds.length > 0 ? excludedDisposition : null,
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

  const items = await db
    .select()
    .from(ontologyChangeSetItems)
    .where(
      and(
        eq(ontologyChangeSetItems.change_set_id, current.id),
        eq(ontologyChangeSetItems.tenant_id, args.tenantId),
      ),
    )
    .orderBy(asc(ontologyChangeSetItems.position));

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

  // R13: fingerprint every rejected candidate so scans never re-propose it.
  await insertOntologyCandidateRejections({
    db,
    tenantId: args.tenantId,
    actorUserId: args.actorUserId,
    items,
    now,
  });

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

/**
 * Item-level reject from the Living Map evidence panel (THINK-320 U6,
 * R13): marks a single still-reviewable item rejected and writes its
 * rejection fingerprint so scans never re-propose the candidate. The
 * owning change set stays open (no status change) and no ontology version
 * is minted. Settled items (approved/applied) raise a conflict.
 */
export async function rejectOntologyChangeSetItem(args: {
  tenantId: string;
  itemId: string;
  actorUserId: string | null;
  reason?: string | null;
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  const now = new Date();

  const [item] = await db
    .select()
    .from(ontologyChangeSetItems)
    .where(
      and(
        eq(ontologyChangeSetItems.id, args.itemId),
        eq(ontologyChangeSetItems.tenant_id, args.tenantId),
      ),
    )
    .limit(1);
  if (!item) throw new Error("Ontology change-set item not found");
  if (item.status === "approved" || item.status === "applied") {
    throw new OntologyChangeSetConflictError(
      `Ontology change-set item ${item.id} is settled (${item.status}) and can no longer be rejected`,
      item.id,
      (item.updated_at instanceof Date
        ? item.updated_at
        : new Date(item.updated_at)
      ).toISOString(),
    );
  }

  const [changeSet] = await db
    .select()
    .from(ontologyChangeSets)
    .where(
      and(
        eq(ontologyChangeSets.id, item.change_set_id),
        eq(ontologyChangeSets.tenant_id, args.tenantId),
      ),
    )
    .limit(1);
  if (!changeSet) throw new Error("Ontology change set not found");
  if (
    TERMINAL_CHANGE_SET_STATUSES.has(
      changeSet.status as OntologyChangeSetStatus,
    )
  ) {
    throw new Error("Ontology change set is already terminal");
  }

  await db
    .update(ontologyChangeSetItems)
    .set({ status: "rejected", updated_at: now })
    .where(
      and(
        eq(ontologyChangeSetItems.id, item.id),
        eq(ontologyChangeSetItems.tenant_id, args.tenantId),
      ),
    );

  // R13: fingerprint the rejected candidate so scans never re-propose it.
  await insertOntologyCandidateRejections({
    db,
    tenantId: args.tenantId,
    actorUserId: args.actorUserId,
    items: [item],
    now,
  });

  await recordOntologyActivity({
    db,
    tenantId: args.tenantId,
    actorUserId: args.actorUserId,
    action: "ontology_change_set_item_rejected",
    changeSetId: changeSet.id,
    entityType: "ontology_change_set_item",
    entityId: item.id,
    metadata: { reason: args.reason ?? null },
  });

  return loadOntologyChangeSet({
    tenantId: args.tenantId,
    changeSetId: changeSet.id,
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
