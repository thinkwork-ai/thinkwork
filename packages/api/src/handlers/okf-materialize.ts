import { S3Client } from "@aws-sdk/client-s3";
import { and, eq, isNull } from "drizzle-orm";
import { wikiPages } from "@thinkwork/database-pg/schema";
import { db } from "../lib/db.js";
import {
  buildOkfBundle,
  loadTenantOkfMaterializationSource,
} from "../lib/okf/materializer.js";
import { publishOkfBundle } from "../lib/okf/publisher.js";

export interface OkfMaterializeEvent {
  tenantId?: string;
  tenantIds?: string[];
  dryRun?: boolean;
  ontologyVersion?: string | null;
}

export interface OkfMaterializeResult {
  ok: boolean;
  dryRun: boolean;
  tenants_processed: number;
  bundles_built: number;
  bundles_published: number;
  pages_exported: number;
  objects_written: number;
  bytes_uploaded: number;
  errors: Array<{ tenantId: string; message: string }>;
}

const REGION = process.env.AWS_REGION || "us-east-1";

export async function handler(
  event: OkfMaterializeEvent = {},
): Promise<OkfMaterializeResult> {
  const result: OkfMaterializeResult = {
    ok: true,
    dryRun: event.dryRun === true,
    tenants_processed: 0,
    bundles_built: 0,
    bundles_published: 0,
    pages_exported: 0,
    objects_written: 0,
    bytes_uploaded: 0,
    errors: [],
  };

  const tenantIds = await resolveTenantIds(event);
  if (tenantIds.length === 0) {
    console.log("[okf-materialize] no tenants with active tenant wiki pages");
    return result;
  }

  const bucket = process.env.BRAIN_ARTIFACTS_BUCKET;
  if (!bucket && !result.dryRun) {
    return {
      ...result,
      ok: false,
      errors: [
        { tenantId: "*", message: "BRAIN_ARTIFACTS_BUCKET env var not set" },
      ],
    };
  }

  const s3 = new S3Client({ region: REGION });
  for (const tenantId of tenantIds) {
    result.tenants_processed += 1;
    try {
      const source = await loadTenantOkfMaterializationSource({
        db,
        tenantId,
      });
      if (source.pages.length === 0) continue;

      const bundle = buildOkfBundle({
        source,
        ontologyVersion: event.ontologyVersion ?? null,
      });
      result.bundles_built += 1;
      result.pages_exported += source.pages.length;

      if (!result.dryRun) {
        const publish = await publishOkfBundle({
          db,
          s3,
          bucket,
          bundle,
        });
        if (publish.enabled) {
          result.bundles_published += 1;
          result.objects_written += publish.objectsWritten;
          result.bytes_uploaded += publish.bytesUploaded;
        }
      }
    } catch (error) {
      result.ok = false;
      result.errors.push({
        tenantId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(`[okf-materialize] ${JSON.stringify(result)}`);
  return result;
}

async function resolveTenantIds(event: OkfMaterializeEvent): Promise<string[]> {
  if (event.tenantId) return [event.tenantId];
  if (event.tenantIds?.length) return [...new Set(event.tenantIds)];

  const predicates = [
    eq(wikiPages.status, "active"),
    isNull(wikiPages.owner_id),
  ];
  const rows = await db
    .selectDistinct({ tenantId: wikiPages.tenant_id })
    .from(wikiPages)
    .where(and(...predicates));
  return rows.map((row) => row.tenantId);
}
