import type { GraphQLContext } from "../../context.js";
import { db, eq, tenants } from "../../utils.js";
import {
  readThreadGoalFile,
  threadGoalFileKey,
  THREAD_GOAL_REQUIRED_FILES,
  type ThreadGoalRequiredFile,
} from "../../../lib/thread-goals/storage.js";
import { findThreadGoalForVisibleThread } from "./threadGoal.query.js";

type ThreadGoalFilesArgs = {
  tenantId: string;
  threadId: string;
};

export async function threadGoalFiles(
  _parent: unknown,
  args: ThreadGoalFilesArgs,
  ctx: GraphQLContext,
) {
  const goal = await findThreadGoalForVisibleThread(args, ctx);
  if (!goal) return null;

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, args.tenantId))
    .limit(1);
  if (!tenant?.slug) return null;

  const files = [];
  for (const file of THREAD_GOAL_REQUIRED_FILES) {
    const address = {
      tenantSlug: tenant.slug,
      threadId: args.threadId,
      file,
    };
    files.push({
      file: goalFileKind(file),
      key: threadGoalFileKey(address),
      content: await readThreadGoalFile(address),
    });
  }

  return { goal, files };
}

function goalFileKind(file: ThreadGoalRequiredFile): string {
  return file.replace(/\.md$/i, "").toUpperCase();
}
