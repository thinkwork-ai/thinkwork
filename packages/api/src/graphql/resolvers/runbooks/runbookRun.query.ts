import type { GraphQLContext } from "../../context.js";
import { getRunbookRun } from "../../../lib/runbooks/runs.js";
import { requireRunbookRunAccess, resolveRunbookCaller } from "./shared.js";

export async function runbookRun(
  _parent: any,
  args: { id: string },
  ctx: GraphQLContext,
) {
  const { tenantId } = await resolveRunbookCaller(ctx);
  await requireRunbookRunAccess(ctx, tenantId, args.id);
  return getRunbookRun({ tenantId, runId: args.id });
}
