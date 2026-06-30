import type { GraphQLContext } from "../../context.js";
import { and, db, eq, piExtensionVersions } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  assertVersionCanBeApproved,
  loadPiExtensionGraphql,
  notFound,
} from "./review-shared.js";

interface ApprovePiExtensionVersionArgs {
  input: {
    tenantId: string;
    versionId: string;
  };
}

export async function approvePiExtensionVersion(
  _parent: unknown,
  args: ApprovePiExtensionVersionArgs,
  ctx: GraphQLContext,
) {
  const { tenantId, versionId } = args.input;
  await requireAdminOrServiceCaller(ctx, tenantId, "pi_extensions:review");
  const actorId = await resolveCallerUserId(ctx);
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

    assertVersionCanBeApproved(version);

    if (version.status !== "approved") {
      const [updated] = await tx
        .update(piExtensionVersions)
        .set({
          status: "approved",
          status_reason: null,
          reviewed_by_user_id: actorId,
          reviewed_at: now,
          approved_by_user_id: actorId,
          approved_at: now,
          rejected_by_user_id: null,
          rejected_at: null,
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
