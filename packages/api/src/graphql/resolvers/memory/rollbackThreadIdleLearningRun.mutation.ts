import type { GraphQLContext } from "../../context.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";
import { readIdleLearningReport } from "../../../lib/requester-memory/storage.js";
import { rollbackRequesterIdleLearningRun } from "../../../lib/requester-memory/rollback.js";
import { serializeThreadIdleLearningRun } from "./threadIdleLearningRuns.query.js";

export async function rollbackThreadIdleLearningRun(
  _parent: unknown,
  args: { tenantId?: string | null; userId?: string | null; runId: string },
  ctx: GraphQLContext,
) {
  const { tenantId, userId } = await requireMemoryUserScope(ctx, {
    ...args,
    allowTenantAdmin: true,
  });
  const result = await rollbackRequesterIdleLearningRun({
    tenantId,
    userId,
    runId: args.runId,
  });

  return serializeThreadIdleLearningRun(result.run, {
    reportMarkdown: await readIdleLearningReport({
      tenantId,
      userId,
      runId: result.run.id,
    }),
  });
}
