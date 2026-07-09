/**
 * Share-row get-or-create (THINK-227 U5, factored from the
 * mintArtifactShareLink resolver's THINK-208 logic so the delivery path can
 * mint/reuse the living-document link without a GraphQL context).
 *
 * Same semantics as the resolver: one active share per artifact (partial
 * unique index on artifact_id WHERE revoked_at IS NULL backs the create
 * race), audit event only on the create leg, and no token material at rest —
 * callers sign the returned share id with `signShareToken`.
 */
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { artifactShares } from "@thinkwork/database-pg/schema";
import { emitAuditEvent } from "../compliance/emit.js";

type Db = ReturnType<typeof getDb>;

export async function getOrCreateArtifactShare(
  db: Db,
  input: {
    tenantId: string;
    artifactId: string;
    /** users.id recorded as the share creator (NOT NULL at the schema). */
    createdBy: string;
    artifactTitle?: string | null;
    /** Audit-event source; the delivery path is a Lambda-side write. */
    source?: "system" | "graphql" | "lambda" | "strands" | "scheduler";
  },
): Promise<{ shareId: string; created: boolean }> {
  const activeShare = and(
    eq(artifactShares.artifact_id, input.artifactId),
    isNull(artifactShares.revoked_at),
  );
  const [existing] = await db
    .select({ id: artifactShares.id })
    .from(artifactShares)
    .where(activeShare);
  if (existing) return { shareId: existing.id, created: false };

  const created = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(artifactShares)
      .values({
        tenant_id: input.tenantId,
        artifact_id: input.artifactId,
        created_by: input.createdBy,
      })
      .onConflictDoNothing()
      .returning({ id: artifactShares.id });
    if (!inserted) return null; // lost the create race — re-select below
    await emitAuditEvent(tx, {
      tenantId: input.tenantId,
      actorId: input.createdBy,
      actorType: "user",
      eventType: "output.artifact_share_created",
      source: input.source ?? "lambda",
      resourceType: "artifact",
      resourceId: input.artifactId,
      action: "share_link_created",
      outcome: "success",
      payload: {
        shareId: inserted.id,
        artifactTitle: input.artifactTitle ?? null,
      },
    });
    return inserted;
  });
  if (created) return { shareId: created.id, created: true };

  const [raced] = await db
    .select({ id: artifactShares.id })
    .from(artifactShares)
    .where(activeShare);
  if (!raced) {
    throw new Error("Failed to create the artifact share link");
  }
  return { shareId: raced.id, created: false };
}
