/**
 * revokeArtifactShareLink (THINK-208 U3).
 *
 * Creators revoke their own links; operators revoke any in the tenant.
 * Revocation flips revoked_at (rows are never deleted) so the public route
 * 404s and history stays queryable. Emits output.artifact_share_revoked.
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, and, isNull, artifactShares } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
import { isTenantOperator } from "../skill-creator/shared.js";
import { emitAuditEvent } from "../../../lib/compliance/emit.js";

export const revokeArtifactShareLink = async (
  _parent: unknown,
  args: { shareId: string },
  ctx: GraphQLContext,
) => {
  const shareId = args.shareId?.trim();
  if (!shareId) {
    throw new GraphQLError("revokeArtifactShareLink shareId is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const caller = await resolveCallerFromAuth(ctx.auth);
  if (!caller.userId || !caller.tenantId) {
    throw new GraphQLError("Requester user identity required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  const [share] = await db
    .select()
    .from(artifactShares)
    .where(eq(artifactShares.id, shareId));
  if (!share || share.revoked_at) {
    throw new GraphQLError("Share link not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await requireTenantMember(ctx, share.tenant_id);
  if (share.tenant_id !== caller.tenantId) {
    throw new GraphQLError("Share link belongs to a different tenant", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  if (share.created_by !== caller.userId) {
    const operator = await isTenantOperator(ctx, share.tenant_id);
    if (!operator) {
      throw new GraphQLError(
        "Only the link's creator or an operator can revoke it",
        {
          extensions: { code: "FORBIDDEN" },
        },
      );
    }
  }

  return await db.transaction(async (tx) => {
    // Conditional update guards a concurrent double-revoke: only the caller
    // that actually flips the row emits the audit event.
    const [updated] = await tx
      .update(artifactShares)
      .set({ revoked_at: new Date(), revoked_by: caller.userId! })
      .where(
        and(eq(artifactShares.id, shareId), isNull(artifactShares.revoked_at)),
      )
      .returning();
    if (!updated) return false;
    await emitAuditEvent(tx, {
      tenantId: share.tenant_id,
      actorId: caller.userId!,
      actorType: "user",
      eventType: "output.artifact_share_revoked",
      source: "graphql",
      resourceType: "artifact",
      resourceId: share.artifact_id,
      action: "share_link_revoked",
      outcome: "success",
      payload: { shareId, createdBy: share.created_by },
    });
    return true;
  });
};
