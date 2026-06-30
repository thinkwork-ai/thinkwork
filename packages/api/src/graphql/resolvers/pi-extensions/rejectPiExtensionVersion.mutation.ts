import type { GraphQLContext } from "../../context.js";
import { and, db, eq, piExtensionVersions } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  badInput,
  loadPiExtensionGraphql,
  notFound,
  shouldRejectVersion,
} from "./review-shared.js";

interface RejectPiExtensionVersionArgs {
  input: {
    tenantId: string;
    versionId: string;
    reason: string;
  };
}

export async function rejectPiExtensionVersion(
  _parent: unknown,
  args: RejectPiExtensionVersionArgs,
  ctx: GraphQLContext,
) {
  const { tenantId, versionId } = args.input;
  await requireAdminOrServiceCaller(ctx, tenantId, "pi_extensions:review");
  const actorId = await resolveCallerUserId(ctx);
  const reason = args.input.reason.trim();
  if (!reason) throw badInput("Rejection reason is required");

  const now = new Date();
  const extension = await db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(piExtensionVersions)
      .where(
        and(
          eq(piExtensionVersions.tenant_id, tenantId),
          eq(piExtensionVersions.id, versionId),
        ),
      );

    if (!version) throw notFound("Pi extension version not found");

    if (shouldRejectVersion(version)) {
      const [updated] = await tx
        .update(piExtensionVersions)
        .set({
          status: "rejected",
          status_reason: reason,
          reviewed_by_user_id: actorId,
          reviewed_at: now,
          approved_by_user_id: null,
          approved_at: null,
          rejected_by_user_id: actorId,
          rejected_at: now,
          updated_at: now,
        })
        .where(
          and(
            eq(piExtensionVersions.tenant_id, tenantId),
            eq(piExtensionVersions.id, versionId),
          ),
        )
        .returning();

      if (!updated) throw notFound("Pi extension version not found");
    }

    return loadPiExtensionGraphql({
      tenantId,
      versionId,
      client: tx,
    });
  });

  return extension;
}
