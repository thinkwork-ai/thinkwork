import type { GraphQLContext } from "../../context.js";
import { db, eq, artifacts } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { assertCanvasAccess } from "../../../lib/artifacts/canvas-access.js";
import { artifactToCamelWithPayload } from "./payload.js";

export const artifact = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const [row] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, args.id));
  if (!row) return null;
  await requireTenantMember(ctx, row.tenant_id);
  // Canvas artifacts are space/thread-scoped (R15). Non-canvas artifacts are a
  // no-op here and keep the tenant-member read path above. This replaced the
  // dead `metadata.kind === "genui_snapshot"` gate — the retired promote writer
  // persisted `json_render_snapshot`, so the old string never matched.
  await assertCanvasAccess(ctx, row, "read");
  return artifactToCamelWithPayload(row);
};
