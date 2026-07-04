import type { GraphQLContext } from "../../context.js";
import { db, eq, artifacts } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import {
  assertCanvasAccess,
  isCanvasArtifact,
} from "../../../lib/artifacts/canvas-access.js";

export const deleteArtifact = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  // Canvas artifacts are space/thread-scoped (R15): deleting one is a write.
  // Non-canvas artifacts keep their existing (unguarded) delete-by-id behavior.
  const [existing] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, args.id));
  if (!existing) return false;
  if (isCanvasArtifact(existing)) {
    await requireTenantMember(ctx, existing.tenant_id);
    await assertCanvasAccess(ctx, existing, "write");
  }
  const [row] = await db
    .delete(artifacts)
    .where(eq(artifacts.id, args.id))
    .returning();
  return !!row;
};
