import type { GraphQLContext } from "../../context.js";
import {
  listRunbookRuns,
  parseRunbookRunStatus,
} from "../../../lib/runbooks/runs.js";
import { requireComputerAccess, resolveRunbookCaller } from "./shared.js";

export async function runbookRuns(
  _parent: any,
  args: {
    computerId: string;
    threadId?: string | null;
    status?: string | null;
    limit?: number | null;
  },
  ctx: GraphQLContext,
) {
  const { tenantId } = await resolveRunbookCaller(ctx);
  await requireComputerAccess(ctx, tenantId, args.computerId);
  return listRunbookRuns({
    tenantId,
    computerId: args.computerId,
    threadId: args.threadId,
    status: parseRunbookRunStatus(args.status),
    limit: args.limit,
  });
}
