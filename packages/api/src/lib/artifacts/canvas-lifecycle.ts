/**
 * Living Artifacts (THINK-145 U4): shared canvas-lifecycle primitives.
 *
 * A GenUI canvas is an artifact from first emission (KTD3, R10). This module
 * holds the pieces the born-as-artifact upsert, the save/pin mutations, and the
 * U8 check-in path all share:
 *
 *  - the canvas metadata `kind` marker + a canvas-detection predicate,
 *  - a deterministic artifact id derived from (tenant, thread, stable part id)
 *    so the first-emission upsert is exactly-once under concurrency via the
 *    primary key (no extra unique index needed),
 *  - {@link pinHeadToVersion}: the write-once version snapshot used by both
 *    `pinArtifact` and the auto-pin-on-re-save (check-in) rule, guarded by the
 *    KTD6 `head_write_seq` conditional UPDATE so a concurrent head change never
 *    silently loses.
 */

import { createHash } from "node:crypto";
import { GraphQLError } from "graphql";
import {
  and,
  artifacts,
  artifactVersions,
  db,
  eq,
  sql,
} from "../../graphql/utils.js";
import { CANVAS_LIVING_KIND } from "./canvas-access.js";
import {
  artifactContentKey,
  isArtifactPayloadS3Key,
  readArtifactPayloadFromS3,
  writeArtifactPayloadToS3,
} from "./payload-storage.js";

/**
 * `artifacts.metadata.kind` marker for a living GenUI canvas. Distinct from the
 * retired promote-copy snapshot kind (`json_render_snapshot`) — living
 * semantics (born-as-artifact, save flip, version chain) apply to this kind
 * only in v1.
 */
export const CANVAS_METADATA_KIND = CANVAS_LIVING_KIND;

/** JSON content type used for canvas head + pinned-version payloads. */
export const CANVAS_CONTENT_TYPE = "application/json; charset=utf-8" as const;

export interface CanvasArtifactRow {
  id: string;
  tenant_id: string;
  type: string;
  status: string;
  content?: string | null;
  s3_key?: string | null;
  head_version?: number | null;
  head_write_seq?: number | null;
  metadata?: unknown;
}

/**
 * True when the metadata carries the LIVING-canvas marker specifically
 * (lifecycle ops apply to living canvases only, not legacy snapshots).
 * Distinct from canvas-access's `isCanvasArtifact`, which matches every
 * canvas kind for access gating.
 */
export function isLivingCanvasMetadata(metadata: unknown): boolean {
  const parsed = parseMetadata(metadata);
  return (
    parsed !== null &&
    (parsed as { kind?: unknown }).kind === CANVAS_METADATA_KIND
  );
}

function parseMetadata(metadata: unknown): Record<string, unknown> | null {
  if (typeof metadata === "string") {
    try {
      return parseMetadata(JSON.parse(metadata));
    } catch {
      return null;
    }
  }
  return metadata !== null &&
    typeof metadata === "object" &&
    !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : null;
}

/**
 * Deterministic artifact id for a canvas keyed by (tenant, thread, stable part
 * id). Because it is the primary key, the born-as-artifact `INSERT ... ON
 * CONFLICT (id)` upsert produces exactly one row per (thread, part id) under
 * concurrent re-emission — no separate unique index required.
 *
 * Formatted as a v5-shaped UUID (deterministic SHA-256 of the key) so it is a
 * valid `uuid` column value.
 */
export function deriveCanvasArtifactId(
  tenantId: string,
  threadId: string,
  stablePartId: string,
): string {
  const hex = createHash("sha256")
    .update(`canvas:${tenantId}:${threadId}:${stablePartId}`)
    .digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Find the SAVED canvas that `threadId` has checked out under `stablePartId`
 * (U8, R13). Check-out records a `{threadId}` entry in the ORIGINAL artifact's
 * `metadata.checkouts` array (see `checkoutCanvas.mutation.ts`); this lookup
 * matches on that plus the artifact's own `metadata.stablePartId`. Returns null
 * when the thread has no check-out for the part — the caller then takes the
 * ordinary derive path, so an unrelated same-stable-id emission is never routed
 * to another thread's artifact.
 *
 * Shared by the born-as-artifact head-update path AND binding capture
 * (THINK-165): both must address the ORIGINAL artifact for a checkout-thread
 * re-emission, or capture targets a (checkout-thread)-derived id that has no
 * artifacts row (observed live as a silent FK violation — bindings never
 * refreshed from checkout threads).
 */
export async function findCheckoutRoutedArtifact(input: {
  tenantId: string;
  threadId: string;
  stablePartId: string;
}): Promise<CanvasArtifactRow | null> {
  const [row] = await db
    .select({
      id: artifacts.id,
      tenant_id: artifacts.tenant_id,
      type: artifacts.type,
      status: artifacts.status,
      content: artifacts.content,
      s3_key: artifacts.s3_key,
      head_version: artifacts.head_version,
      head_write_seq: artifacts.head_write_seq,
      metadata: artifacts.metadata,
    })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.tenant_id, input.tenantId),
        sql`${artifacts.metadata}->>'stablePartId' = ${input.stablePartId}`,
        sql`${artifacts.metadata}->'checkouts' @> ${JSON.stringify([
          { threadId: input.threadId },
        ])}::jsonb`,
      ),
    )
    .limit(1);
  return (row as CanvasArtifactRow | undefined) ?? null;
}

/** Load the canvas head content (from S3 when offloaded, else inline). */
export async function loadCanvasHeadContent(
  row: CanvasArtifactRow,
): Promise<string> {
  if (row.s3_key && isArtifactPayloadS3Key(row.tenant_id, row.s3_key)) {
    return readArtifactPayloadFromS3({
      tenantId: row.tenant_id,
      key: row.s3_key,
    });
  }
  return typeof row.content === "string" ? row.content : "";
}

/**
 * Pin the currently-persisted head as a write-once, content-addressed version
 * (KTD3). Used by `pinArtifact` and by the auto-pin-on-re-save check-in rule
 * (reused by U8's check-in path).
 *
 * The whole mutation is guarded by a single conditional UPDATE on
 * `head_write_seq` (KTD6): if another writer advanced the head between the read
 * and this call, the UPDATE matches zero rows and we throw CONFLICT rather than
 * clobber. `extraUpdates` (e.g. title/space_id on a re-save) ride the same
 * guarded UPDATE so naming + the version bump are atomic.
 *
 * Returns the updated head row.
 */
export async function pinHeadToVersion(input: {
  row: CanvasArtifactRow;
  userId: string | null;
  extraUpdates?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const { row, userId } = input;
  const observedSeq = row.head_write_seq ?? 0;
  const newVersion = (row.head_version ?? 0) + 1;

  // Content-addressed, write-once revision key. Writing it is idempotent by
  // hash, so it is safe to write before the guarded UPDATE claims the pin.
  const content = await loadCanvasHeadContent(row);
  const contentHash = createHash("sha256").update(content).digest("hex");
  const revisionKey = artifactContentKey({
    tenantId: row.tenant_id,
    artifactId: row.id,
    revision: contentHash,
  });
  await writeArtifactPayloadToS3({
    tenantId: row.tenant_id,
    key: revisionKey,
    body: content,
    contentType: CANVAS_CONTENT_TYPE,
  });

  const [updated] = await db
    .update(artifacts)
    .set({
      head_version: newVersion,
      head_write_seq: sql`${artifacts.head_write_seq} + 1`,
      updated_at: new Date(),
      ...(input.extraUpdates ?? {}),
    })
    .where(
      and(eq(artifacts.id, row.id), eq(artifacts.head_write_seq, observedSeq)),
    )
    .returning();
  if (!updated) {
    throw new GraphQLError("Canvas head changed concurrently; retry the pin", {
      extensions: { code: "CONFLICT" },
    });
  }

  await db.insert(artifactVersions).values({
    tenant_id: row.tenant_id,
    artifact_id: row.id,
    version: newVersion,
    s3_key: revisionKey,
    content_hash: contentHash,
    created_by: userId,
  });

  return updated as Record<string, unknown>;
}

/** Normalize + bound a user-supplied string (titles/summaries). */
export function boundedCanvasText(value: string, max: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= max) return normalized;
  return normalized.slice(0, max - 1).trimEnd() + "...";
}
