/**
 * mintArtifactShareLink (THINK-208 U3).
 *
 * Get-or-create the public "anyone with the link" share for a document
 * artifact and return the signed URL. Re-sharing (same or different member)
 * resurfaces the existing active link rather than minting duplicates (R4) —
 * the partial unique index on (artifact_id) WHERE revoked_at IS NULL backs
 * the create race. Only the create leg emits an audit event.
 */

import { GraphQLError } from "graphql";
import { getConfig } from "@thinkwork/runtime-config";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  isNull,
  artifacts,
  artifactShares,
} from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
import { assertCanvasAccess } from "../../../lib/artifacts/canvas-access.js";
import { isDocumentMetadata } from "../../../lib/artifacts/document-emission.js";
import { signShareToken } from "../../../lib/artifacts/share-tokens.js";
import { emitAuditEvent } from "../../../lib/compliance/emit.js";
import { shareToGql, type ArtifactShareRow } from "./artifactShares.query.js";

export function shareUrlBase(): string {
  const apiBaseUrl = (getConfig("THINKWORK_API_URL") ?? "").replace(/\/$/, "");
  if (!apiBaseUrl) {
    throw new GraphQLError("THINKWORK_API_URL is not configured", {
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  }
  return apiBaseUrl;
}

export const mintArtifactShareLink = async (
  _parent: unknown,
  args: { artifactId: string },
  ctx: GraphQLContext,
) => {
  const artifactId = args.artifactId?.trim();
  if (!artifactId) {
    throw new GraphQLError("mintArtifactShareLink artifactId is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const caller = await resolveCallerFromAuth(ctx.auth);
  if (!caller.userId || !caller.tenantId) {
    throw new GraphQLError("Requester user identity required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  const [row] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, artifactId));
  if (!row) {
    throw new GraphQLError("Artifact not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  // Tenant derived from the artifact row, never from args; plus the
  // document's actual read gate — tenant membership alone would let a member
  // publish a private-space/draft document they cannot read (KTD-8).
  await requireTenantMember(ctx, row.tenant_id);
  if (row.tenant_id !== caller.tenantId) {
    throw new GraphQLError("Artifact belongs to a different tenant", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  await assertCanvasAccess(ctx, row, "read");
  if (!isDocumentMetadata(row.metadata)) {
    throw new GraphQLError("Only document artifacts can be shared publicly", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  // THINK-234 lifted the THINK-228 KTD9 query-binding share gate: analyst
  // refreshes are now row-level tenant-scoped at the database (RLS policies
  // keyed to the broker's verified-tenant GUC, drizzle/0230), so a shared
  // snapshot can only ever contain the owning tenant's rows. The public
  // share route itself never executes queries — it serves the precompiled
  // render — so scoped refresh closes the last cross-tenant leg.

  const baseUrl = shareUrlBase();

  const activeShare = eq(artifactShares.artifact_id, artifactId);
  const [existing] = await db
    .select()
    .from(artifactShares)
    .where(and(activeShare, isNull(artifactShares.revoked_at)));
  if (existing) {
    // Re-share: re-sign the existing share id (the URL is re-derivable —
    // no token material at rest, KTD-1). No new row, no audit event.
    return {
      url: `${baseUrl}/share/${signShareToken(existing.id)}`,
      share: shareToGql(existing as ArtifactShareRow, row.title),
    };
  }

  const created = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(artifactShares)
      .values({
        tenant_id: row.tenant_id,
        artifact_id: artifactId,
        created_by: caller.userId!,
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted) return null; // lost the create race — re-select below
    await emitAuditEvent(tx, {
      tenantId: row.tenant_id,
      actorId: caller.userId!,
      actorType: "user",
      eventType: "output.artifact_share_created",
      source: "graphql",
      resourceType: "artifact",
      resourceId: artifactId,
      action: "share_link_created",
      outcome: "success",
      payload: { shareId: inserted.id, artifactTitle: row.title },
    });
    return inserted;
  });

  const share =
    created ??
    (
      await db
        .select()
        .from(artifactShares)
        .where(and(activeShare, isNull(artifactShares.revoked_at)))
    )[0];
  if (!share) {
    throw new GraphQLError("Failed to create share link", {
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  }

  return {
    url: `${baseUrl}/share/${signShareToken(share.id)}`,
    share: shareToGql(share as ArtifactShareRow, row.title),
  };
};
