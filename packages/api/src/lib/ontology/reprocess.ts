import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  ontologyChangeSetItems,
  ontologyChangeSets,
  ontologyEntityTypes,
  ontologyExternalMappings,
  ontologyFacetTemplates,
  ontologyRelationshipTypes,
  ontologyReprocessJobs,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import { toOntologyReprocessJob } from "./mappers.js";
import {
  analyzeOntologyReprocessImpact,
  loadOntologyImpactItems,
  type OntologyImpactItem,
  type OntologyReprocessImpact,
} from "./impact.js";

type DbLike = typeof defaultDb;

const TERMINAL_REPROCESS_STATUSES = new Set([
  "succeeded",
  "failed",
  "canceled",
]);

export interface OntologyReprocessResult {
  ok: boolean;
  jobId?: string;
  status: "succeeded" | "failed" | "no_job" | "already_done";
  impact?: OntologyReprocessImpact;
  metrics?: Record<string, unknown>;
  error?: string;
}

export function buildOntologyReprocessDedupeKey(args: {
  tenantId: string;
  changeSetId: string;
  ontologyVersionId: string;
  continuation?: number | null;
}) {
  const base = `ontology:${args.tenantId}:${args.changeSetId}:${args.ontologyVersionId}`;
  return args.continuation ? `${base}:continuation:${args.continuation}` : base;
}

export async function enqueueOntologyReprocessJob(args: {
  tenantId: string;
  changeSetId: string;
  ontologyVersionId: string;
  approvedItemIds: string[];
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  const dedupeKey = buildOntologyReprocessDedupeKey(args);
  const input = {
    changeSetId: args.changeSetId,
    ontologyVersionId: args.ontologyVersionId,
    approvedItemIds: args.approvedItemIds,
  };

  const [inserted] = await db
    .insert(ontologyReprocessJobs)
    .values({
      tenant_id: args.tenantId,
      change_set_id: args.changeSetId,
      ontology_version_id: args.ontologyVersionId,
      dedupe_key: dedupeKey,
      status: "pending",
      input,
      impact: {},
      metrics: {},
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) return { inserted: true, job: inserted };

  const [existing] = await db
    .select()
    .from(ontologyReprocessJobs)
    .where(
      and(
        eq(ontologyReprocessJobs.tenant_id, args.tenantId),
        eq(ontologyReprocessJobs.dedupe_key, dedupeKey),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new Error(
      `Ontology reprocess dedupe conflict but no existing job was found for key=${dedupeKey}`,
    );
  }
  return { inserted: false, job: existing };
}

export async function invokeOntologyReprocessJob(args: {
  jobId: string;
  lambdaClient?: Pick<LambdaClient, "send">;
}) {
  const functionName =
    process.env.ONTOLOGY_REPROCESS_FUNCTION_NAME ||
    (process.env.STAGE
      ? `thinkwork-${process.env.STAGE}-api-ontology-reprocess`
      : "");
  if (!functionName) {
    return {
      state: "skipped",
      reason: "ONTOLOGY_REPROCESS_FUNCTION_NAME unset",
    };
  }

  const client =
    args.lambdaClient ??
    new LambdaClient({ region: process.env.AWS_REGION || "us-east-1" });
  await client.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify({ jobId: args.jobId })),
    }),
  );
  return { state: "invoked", functionName };
}

export async function markOntologyReprocessInvokeFailed(args: {
  jobId: string;
  error: string;
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  await db
    .update(ontologyReprocessJobs)
    .set({
      metrics: { invokeFailure: true },
      error: args.error,
      updated_at: new Date(),
    })
    .where(eq(ontologyReprocessJobs.id, args.jobId));
}

export async function loadRawOntologyReprocessJob(args: {
  jobId: string;
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  const [job] = await db
    .select()
    .from(ontologyReprocessJobs)
    .where(eq(ontologyReprocessJobs.id, args.jobId))
    .limit(1);
  return job ?? null;
}

export async function claimNextOntologyReprocessJob(db: DbLike = defaultDb) {
  const result = await db.execute(sql`
    UPDATE ${ontologyReprocessJobs}
    SET status = 'running',
        claimed_at = now(),
        started_at = now(),
        attempt = attempt + 1,
        updated_at = now()
    WHERE id = (
      SELECT id
      FROM ${ontologyReprocessJobs}
      WHERE status = 'pending'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `);
  return firstSqlRow(result);
}

export async function claimOntologyReprocessJobById(
  jobId: string,
  db: DbLike = defaultDb,
) {
  if (!isUuid(jobId)) return null;
  const result = await db.execute(sql`
    UPDATE ${ontologyReprocessJobs}
    SET status = 'running',
        claimed_at = now(),
        started_at = now(),
        attempt = attempt + 1,
        updated_at = now()
    WHERE id = ${jobId} AND status = 'pending'
    RETURNING *
  `);
  return firstSqlRow(result);
}

export async function runOntologyReprocess(args: {
  jobId?: string | null;
  db?: DbLike;
  pageCap?: number;
}): Promise<OntologyReprocessResult> {
  const db = args.db ?? defaultDb;
  const claimed = args.jobId
    ? await claimOntologyReprocessJobById(args.jobId, db)
    : await claimNextOntologyReprocessJob(db);

  if (!claimed) {
    if (!args.jobId) return { ok: true, status: "no_job" };
    const existing = await loadRawOntologyReprocessJob({
      jobId: args.jobId,
      db,
    });
    if (existing && TERMINAL_REPROCESS_STATUSES.has(String(existing.status))) {
      return {
        ok: true,
        jobId: existing.id,
        status: "already_done",
        metrics: (existing.metrics ?? {}) as Record<string, unknown>,
      };
    }
    return { ok: true, jobId: args.jobId, status: "already_done" };
  }

  try {
    const result = await processClaimedOntologyReprocessJob({
      job: claimed,
      db,
      pageCap: args.pageCap,
    });
    return {
      ok: true,
      jobId: claimed.id,
      status: "succeeded",
      impact: result.impact,
      metrics: result.metrics,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await completeOntologyReprocessJob({
      jobId: claimed.id,
      status: "failed",
      error: message,
      metrics: { failure: true },
      db,
    });
    return {
      ok: false,
      jobId: claimed.id,
      status: "failed",
      error: message,
      metrics: { failure: true },
    };
  }
}

async function processClaimedOntologyReprocessJob(args: {
  job: any;
  db: DbLike;
  pageCap?: number;
}) {
  if (!args.job.tenant_id || !args.job.change_set_id) {
    throw new Error("Ontology reprocess job is missing tenant/change-set ids");
  }
  const items = await loadOntologyImpactItems({
    tenantId: args.job.tenant_id,
    changeSetId: args.job.change_set_id,
    db: args.db,
  });
  const applicableItems = items.filter(
    (item: any) => item.status !== "rejected" && item.action !== "reject",
  );
  const impact = await analyzeOntologyReprocessImpact({
    tenantId: args.job.tenant_id,
    items: applicableItems,
    db: args.db,
    pageCap: args.pageCap,
  });
  const metrics = {
    approvedItems: applicableItems.length,
    affectedPages: impact.affectedPageCount,
    affectedExternalRefs: impact.affectedExternalRefCount,
    capHit: impact.capHit,
    materialization: "definition_apply_only",
  };

  await args.db.transaction(async (tx) => {
    const txDb = tx as unknown as DbLike;
    await applyOntologyChangeSetItems({
      tenantId: args.job.tenant_id,
      ontologyVersionId: args.job.ontology_version_id,
      items: applicableItems,
      db: txDb,
    });
    const applicableItemIds = applicableItems
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string");
    if (applicableItemIds.length > 0) {
      await txDb
        .update(ontologyChangeSetItems)
        .set({ status: "applied", updated_at: new Date() })
        .where(
          and(
            eq(ontologyChangeSetItems.tenant_id, args.job.tenant_id),
            inArray(ontologyChangeSetItems.id, applicableItemIds),
          ),
        );
    }
    await txDb
      .update(ontologyChangeSets)
      .set({ status: "applied", updated_at: new Date() })
      .where(eq(ontologyChangeSets.id, args.job.change_set_id));
    await txDb
      .update(ontologyReprocessJobs)
      .set({
        status: "succeeded",
        finished_at: new Date(),
        impact,
        metrics,
        error: null,
        updated_at: new Date(),
      })
      .where(eq(ontologyReprocessJobs.id, args.job.id));
  });

  return { impact, metrics };
}

export async function applyOntologyChangeSetItems(args: {
  tenantId: string;
  ontologyVersionId: string | null;
  items: OntologyImpactItem[];
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  const entityItems = args.items.filter(
    (item) => item.item_type === "entity_type",
  );
  const relationshipItems = args.items.filter(
    (item) => item.item_type === "relationship_type",
  );
  const facetItems = args.items.filter(
    (item) => item.item_type === "facet_template",
  );
  const mappingItems = args.items.filter(
    (item) => item.item_type === "external_mapping",
  );

  for (const item of entityItems) {
    await applyEntityTypeItem({ ...args, item, db });
  }
  for (const item of relationshipItems) {
    await applyRelationshipTypeItem({ ...args, item, db });
  }
  for (const item of facetItems) {
    await applyFacetTemplateItem({ ...args, item, db });
  }
  for (const item of mappingItems) {
    await applyExternalMappingItem({ ...args, item, db });
  }
}

async function applyEntityTypeItem(args: {
  tenantId: string;
  ontologyVersionId: string | null;
  item: OntologyImpactItem;
  db: DbLike;
}) {
  const value = itemValue(args.item);
  const slug = stringValue(value.slug) || stringValue(args.item.target_slug);
  if (!slug) return;
  if (args.item.action === "deprecate") {
    await args.db
      .update(ontologyEntityTypes)
      .set({ lifecycle_status: "deprecated", deprecated_at: new Date() })
      .where(
        and(
          eq(ontologyEntityTypes.tenant_id, args.tenantId),
          eq(ontologyEntityTypes.slug, slug),
        ),
      );
    return;
  }

  await args.db
    .insert(ontologyEntityTypes)
    .values({
      tenant_id: args.tenantId,
      version_id: args.ontologyVersionId,
      slug,
      name: stringValue(value.name) || titleize(slug),
      description: nullableString(value.description),
      broad_type: stringValue(value.broadType) || "entity",
      aliases: stringArray(value.aliases),
      properties_schema: objectValue(value.propertiesSchema),
      guidance_notes: nullableString(value.guidanceNotes),
      lifecycle_status: "approved",
      approved_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [ontologyEntityTypes.tenant_id, ontologyEntityTypes.slug],
      set: {
        version_id: args.ontologyVersionId,
        name: stringValue(value.name) || titleize(slug),
        description: nullableString(value.description),
        broad_type: stringValue(value.broadType) || "entity",
        aliases: stringArray(value.aliases),
        properties_schema: objectValue(value.propertiesSchema),
        guidance_notes: nullableString(value.guidanceNotes),
        lifecycle_status: "approved",
        approved_at: new Date(),
        deprecated_at: null,
        rejected_at: null,
        updated_at: new Date(),
      },
    });
}

async function applyRelationshipTypeItem(args: {
  tenantId: string;
  ontologyVersionId: string | null;
  item: OntologyImpactItem;
  db: DbLike;
}) {
  const value = itemValue(args.item);
  const slug = stringValue(value.slug) || stringValue(args.item.target_slug);
  if (!slug) return;
  if (args.item.action === "deprecate") {
    await args.db
      .update(ontologyRelationshipTypes)
      .set({ lifecycle_status: "deprecated", deprecated_at: new Date() })
      .where(
        and(
          eq(ontologyRelationshipTypes.tenant_id, args.tenantId),
          eq(ontologyRelationshipTypes.slug, slug),
        ),
      );
    return;
  }

  const sourceId = await entityIdForSlug({
    tenantId: args.tenantId,
    slug: firstString(value.sourceTypeSlugs),
    db: args.db,
  });
  const targetId = await entityIdForSlug({
    tenantId: args.tenantId,
    slug: firstString(value.targetTypeSlugs),
    db: args.db,
  });

  await args.db
    .insert(ontologyRelationshipTypes)
    .values({
      tenant_id: args.tenantId,
      version_id: args.ontologyVersionId,
      slug,
      name: stringValue(value.name) || titleize(slug),
      description: nullableString(value.description),
      inverse_name: nullableString(value.inverseName),
      source_entity_type_id: sourceId,
      target_entity_type_id: targetId,
      source_type_slugs: stringArray(value.sourceTypeSlugs),
      target_type_slugs: stringArray(value.targetTypeSlugs),
      aliases: stringArray(value.aliases),
      guidance_notes: nullableString(value.guidanceNotes),
      lifecycle_status: "approved",
      approved_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        ontologyRelationshipTypes.tenant_id,
        ontologyRelationshipTypes.slug,
      ],
      set: {
        version_id: args.ontologyVersionId,
        name: stringValue(value.name) || titleize(slug),
        description: nullableString(value.description),
        inverse_name: nullableString(value.inverseName),
        source_entity_type_id: sourceId,
        target_entity_type_id: targetId,
        source_type_slugs: stringArray(value.sourceTypeSlugs),
        target_type_slugs: stringArray(value.targetTypeSlugs),
        aliases: stringArray(value.aliases),
        guidance_notes: nullableString(value.guidanceNotes),
        lifecycle_status: "approved",
        approved_at: new Date(),
        deprecated_at: null,
        rejected_at: null,
        updated_at: new Date(),
      },
    });
}

async function applyFacetTemplateItem(args: {
  tenantId: string;
  item: OntologyImpactItem;
  db: DbLike;
}) {
  const value = itemValue(args.item);
  const entitySlug = stringValue(value.entityTypeSlug);
  const slug = stringValue(value.slug) || stringValue(args.item.target_slug);
  if (!entitySlug || !slug) return;
  const entityTypeId = await entityIdForSlug({
    tenantId: args.tenantId,
    slug: entitySlug,
    db: args.db,
  });
  if (!entityTypeId) return;
  if (args.item.action === "deprecate") {
    await args.db
      .update(ontologyFacetTemplates)
      .set({ lifecycle_status: "deprecated", updated_at: new Date() })
      .where(
        and(
          eq(ontologyFacetTemplates.tenant_id, args.tenantId),
          eq(ontologyFacetTemplates.entity_type_id, entityTypeId),
          eq(ontologyFacetTemplates.slug, slug),
        ),
      );
    return;
  }

  await args.db
    .insert(ontologyFacetTemplates)
    .values({
      tenant_id: args.tenantId,
      entity_type_id: entityTypeId,
      slug,
      heading: stringValue(value.heading) || titleize(slug),
      facet_type: stringValue(value.facetType) || "compiled",
      position: numberValue(value.position),
      source_priority: Array.isArray(value.sourcePriority)
        ? value.sourcePriority
        : [],
      prompt: nullableString(value.prompt),
      guidance_notes: nullableString(value.guidanceNotes),
      lifecycle_status: "approved",
    })
    .onConflictDoUpdate({
      target: [
        ontologyFacetTemplates.entity_type_id,
        ontologyFacetTemplates.slug,
      ],
      set: {
        heading: stringValue(value.heading) || titleize(slug),
        facet_type: stringValue(value.facetType) || "compiled",
        position: numberValue(value.position),
        source_priority: Array.isArray(value.sourcePriority)
          ? value.sourcePriority
          : [],
        prompt: nullableString(value.prompt),
        guidance_notes: nullableString(value.guidanceNotes),
        lifecycle_status: "approved",
        updated_at: new Date(),
      },
    });
}

async function applyExternalMappingItem(args: {
  tenantId: string;
  item: OntologyImpactItem;
  db: DbLike;
}) {
  const value = itemValue(args.item);
  const subjectKind = stringValue(value.subjectKind);
  const subjectSlug = stringValue(value.subjectSlug);
  const vocabulary = stringValue(value.vocabulary);
  const externalUri = stringValue(value.externalUri);
  if (!subjectKind || !subjectSlug || !vocabulary || !externalUri) return;
  const subjectId = await subjectIdForMapping({
    tenantId: args.tenantId,
    subjectKind,
    subjectSlug,
    db: args.db,
  });
  if (!subjectId) return;

  await args.db
    .insert(ontologyExternalMappings)
    .values({
      tenant_id: args.tenantId,
      subject_kind: subjectKind,
      subject_id: subjectId,
      mapping_kind: stringValue(value.mappingKind) || "related",
      vocabulary,
      external_uri: externalUri,
      external_label: nullableString(value.externalLabel),
      notes: nullableString(value.notes),
    })
    .onConflictDoUpdate({
      target: [
        ontologyExternalMappings.subject_kind,
        ontologyExternalMappings.subject_id,
        ontologyExternalMappings.vocabulary,
        ontologyExternalMappings.external_uri,
      ],
      set: {
        mapping_kind: stringValue(value.mappingKind) || "related",
        external_label: nullableString(value.externalLabel),
        notes: nullableString(value.notes),
        updated_at: new Date(),
      },
    });
}

export async function completeOntologyReprocessJob(args: {
  jobId: string;
  status: "succeeded" | "failed" | "canceled";
  impact?: OntologyReprocessImpact;
  metrics?: Record<string, unknown>;
  error?: string | null;
  db?: DbLike;
}) {
  const db = args.db ?? defaultDb;
  await db
    .update(ontologyReprocessJobs)
    .set({
      status: args.status,
      finished_at: new Date(),
      impact: args.impact ?? {},
      metrics: args.metrics ?? {},
      error: args.error ?? null,
      updated_at: new Date(),
    })
    .where(eq(ontologyReprocessJobs.id, args.jobId));
}

function firstSqlRow(result: unknown): any | null {
  if (Array.isArray(result)) return result[0] ?? null;
  return ((result as { rows?: unknown[] })?.rows?.[0] as any) ?? null;
}

function itemValue(item: OntologyImpactItem): Record<string, any> {
  const value = item.edited_value ?? item.proposed_value;
  return value && typeof value === "object"
    ? (value as Record<string, any>)
    : {};
}

async function entityIdForSlug(args: {
  tenantId: string;
  slug: string | null;
  db: DbLike;
}) {
  if (!args.slug) return null;
  const [row] = await args.db
    .select({ id: ontologyEntityTypes.id })
    .from(ontologyEntityTypes)
    .where(
      and(
        eq(ontologyEntityTypes.tenant_id, args.tenantId),
        eq(ontologyEntityTypes.slug, args.slug),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function subjectIdForMapping(args: {
  tenantId: string;
  subjectKind: string;
  subjectSlug: string;
  db: DbLike;
}) {
  if (args.subjectKind === "entity_type") {
    return entityIdForSlug({
      tenantId: args.tenantId,
      slug: args.subjectSlug,
      db: args.db,
    });
  }
  if (args.subjectKind === "relationship_type") {
    const [row] = await args.db
      .select({ id: ontologyRelationshipTypes.id })
      .from(ontologyRelationshipTypes)
      .where(
        and(
          eq(ontologyRelationshipTypes.tenant_id, args.tenantId),
          eq(ontologyRelationshipTypes.slug, args.subjectSlug),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }
  if (args.subjectKind === "facet_template") {
    const [row] = await args.db
      .select({ id: ontologyFacetTemplates.id })
      .from(ontologyFacetTemplates)
      .where(
        and(
          eq(ontologyFacetTemplates.tenant_id, args.tenantId),
          eq(ontologyFacetTemplates.slug, args.subjectSlug),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }
  return null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown): string | null {
  const text = stringValue(value);
  return text || null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function firstString(value: unknown): string | null {
  return stringArray(value)[0] ?? null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function titleize(slug: string): string {
  return slug
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function mapOntologyReprocessJob(row: any) {
  return toOntologyReprocessJob(row);
}
