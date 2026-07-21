/**
 * Compiled twin mapping export (Company Brain U3 / KTD-3).
 *
 * The single artifact the generic Neptune projection (etl-platform) consumes:
 * a per-tenant, versioned JSON document compiling every twin declaration —
 * entity types with their facet declarations (clone policy, cadence,
 * attribute mappings) and page sections, relationship types with their
 * deterministic FK source bindings. The ETL side never reads ontology rows;
 * this export is the only contract surface, so its `format` string is the
 * cross-repo compatibility gate (the projection refuses a format it doesn't
 * understand — fail loud, not skew).
 *
 * Versioning: `sequence` is monotone per tenant — the active ontology
 * version number plus the sum of every declaration jsonb's version counter
 * (each only ever increments, on change-set apply or operator set-mutation).
 * `contentHash` is a stable sha256 of the compiled body (volatile fields
 * excluded) for idempotent-regeneration detection. The projection stamps
 * every synced facet with the sequence it was produced under (KTD-3), so a
 * limit flip is orderable against in-flight syncs.
 *
 * Storage: the brain-artifacts bucket (versioned), under
 * `twin-mapping/<tenantId>/by-sequence/<sequence>.json` (immutable) and
 * `twin-mapping/<tenantId>/latest.json` (pointer the projection polls).
 */

import { createHash } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import {
  ontologyEntityTypes,
  ontologyRelationshipTypes,
  ontologyVersions,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import {
  parsePageSectionDeclarations,
  parseRelationshipSourceBinding,
  parseTwinFacetDeclarations,
  type PageSectionDeclaration,
  type RelationshipSourceBinding,
  type TwinFacetDeclaration,
} from "./twin-declarations.js";

type DbLike = typeof defaultDb;
type TwinExportS3Client = Pick<S3Client, "send">;

export const TWIN_MAPPING_FORMAT = "twin-mapping/v1";

export interface TwinMappingEntity {
  slug: string;
  name: string;
  facets: TwinFacetDeclaration[];
  pageSections: PageSectionDeclaration[];
}

export interface TwinMappingRelationship {
  slug: string;
  name: string;
  sourceTypeSlugs: string[];
  targetTypeSlugs: string[];
  binding: RelationshipSourceBinding | null;
}

export interface TwinMappingExport {
  format: typeof TWIN_MAPPING_FORMAT;
  tenantId: string;
  ontologyVersion: number;
  /** Monotone per-tenant version — see module doc. */
  sequence: number;
  contentHash: string;
  compiledAt: string;
  entities: TwinMappingEntity[];
  relationships: TwinMappingRelationship[];
}

/**
 * Compile the export from approved ontology rows. Pure read — no writes.
 * Deterministic: same declarations in, byte-identical body out (excluding
 * `compiledAt`, which is excluded from `contentHash` for that reason).
 */
export async function compileTwinMappingExport(args: {
  tenantId: string;
  db?: DbLike;
  now?: Date;
}): Promise<TwinMappingExport> {
  const db = args.db ?? defaultDb;

  const [activeVersion] = await db
    .select({ version_number: ontologyVersions.version_number })
    .from(ontologyVersions)
    .where(
      and(
        eq(ontologyVersions.tenant_id, args.tenantId),
        eq(ontologyVersions.status, "active"),
      ),
    )
    .limit(1);

  const entityRows = await db
    .select({
      slug: ontologyEntityTypes.slug,
      name: ontologyEntityTypes.name,
      lifecycle_status: ontologyEntityTypes.lifecycle_status,
      twin_facets: ontologyEntityTypes.twin_facets,
      twin_facets_version: ontologyEntityTypes.twin_facets_version,
      page_sections: ontologyEntityTypes.page_sections,
      page_sections_version: ontologyEntityTypes.page_sections_version,
    })
    .from(ontologyEntityTypes)
    .where(eq(ontologyEntityTypes.tenant_id, args.tenantId));

  const relationshipRows = await db
    .select({
      slug: ontologyRelationshipTypes.slug,
      name: ontologyRelationshipTypes.name,
      lifecycle_status: ontologyRelationshipTypes.lifecycle_status,
      source_type_slugs: ontologyRelationshipTypes.source_type_slugs,
      target_type_slugs: ontologyRelationshipTypes.target_type_slugs,
      source_binding: ontologyRelationshipTypes.source_binding,
      source_binding_version: ontologyRelationshipTypes.source_binding_version,
    })
    .from(ontologyRelationshipTypes)
    .where(eq(ontologyRelationshipTypes.tenant_id, args.tenantId));

  const ontologyVersion = activeVersion?.version_number ?? 0;

  let declarationVersionSum = 0;
  const entities: TwinMappingEntity[] = [];
  for (const row of entityRows.sort((a, b) => a.slug.localeCompare(b.slug))) {
    declarationVersionSum +=
      (row.twin_facets_version ?? 0) + (row.page_sections_version ?? 0);
    if (row.lifecycle_status !== "approved") continue;
    const facets = parseTwinFacetDeclarations(row.twin_facets);
    const pageSections = parsePageSectionDeclarations(row.page_sections);
    if (facets.length === 0 && pageSections.length === 0) continue;
    entities.push({ slug: row.slug, name: row.name, facets, pageSections });
  }

  const relationships: TwinMappingRelationship[] = [];
  for (const row of relationshipRows.sort((a, b) =>
    a.slug.localeCompare(b.slug),
  )) {
    declarationVersionSum += row.source_binding_version ?? 0;
    if (row.lifecycle_status !== "approved") continue;
    const binding = parseRelationshipSourceBinding(row.source_binding);
    if (!binding) continue;
    relationships.push({
      slug: row.slug,
      name: row.name,
      sourceTypeSlugs: row.source_type_slugs ?? [],
      targetTypeSlugs: row.target_type_slugs ?? [],
      binding,
    });
  }

  const body = {
    format: TWIN_MAPPING_FORMAT as typeof TWIN_MAPPING_FORMAT,
    tenantId: args.tenantId,
    ontologyVersion,
    sequence: ontologyVersion + declarationVersionSum,
    entities,
    relationships,
  };
  const contentHash = createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex");

  return {
    ...body,
    contentHash,
    compiledAt: (args.now ?? new Date()).toISOString(),
  };
}

export interface TwinExportUploadResult {
  state: "uploaded" | "skipped_no_bucket" | "skipped_empty" | "error";
  sequence?: number;
  contentHash?: string;
  latestKey?: string;
  error?: string;
}

/**
 * Compile and upload the tenant's twin mapping export. Best-effort by
 * contract: callers ride post-commit hooks and provisioning flows, so this
 * NEVER throws — failures come back in the result (and are logged) while
 * the triggering write stands. A tenant with no twin declarations at all
 * skips the upload (`skipped_empty`) so unrelated ontology applies on
 * undeclared tenants cost nothing.
 */
export async function regenerateTwinMappingExport(args: {
  tenantId: string;
  db?: DbLike;
  s3?: TwinExportS3Client;
  bucket?: string;
  now?: Date;
}): Promise<TwinExportUploadResult> {
  try {
    const bucket = args.bucket ?? process.env.BRAIN_ARTIFACTS_BUCKET ?? null;
    if (!bucket) {
      return { state: "skipped_no_bucket" };
    }
    const exportDoc = await compileTwinMappingExport({
      tenantId: args.tenantId,
      db: args.db,
      now: args.now,
    });
    if (
      exportDoc.entities.length === 0 &&
      exportDoc.relationships.length === 0
    ) {
      return { state: "skipped_empty", sequence: exportDoc.sequence };
    }
    const s3 = args.s3 ?? new S3Client({});
    const payload = JSON.stringify(exportDoc, null, 2);
    const prefix = `twin-mapping/${exportDoc.tenantId}`;
    const bySequenceKey = `${prefix}/by-sequence/${exportDoc.sequence}.json`;
    const latestKey = `${prefix}/latest.json`;
    for (const key of [bySequenceKey, latestKey]) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: payload,
          ContentType: "application/json",
          Metadata: {
            twin_export_sequence: String(exportDoc.sequence),
            twin_export_content_hash: exportDoc.contentHash,
          },
        }),
      );
    }
    return {
      state: "uploaded",
      sequence: exportDoc.sequence,
      contentHash: exportDoc.contentHash,
      latestKey,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[twin-export] regeneration failed", {
      tenantId: args.tenantId,
      error: message,
    });
    return { state: "error", error: message };
  }
}
