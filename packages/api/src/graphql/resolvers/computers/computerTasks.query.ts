import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, computers } from "../../utils.js";
import {
  listComputerTasks,
  parseComputerTaskStatus,
} from "../../../lib/computers/tasks.js";
import { requireComputerReadAccess } from "./shared.js";

export async function computerTasks(
  _parent: any,
  args: { computerId: string; status?: string | null; limit?: number | null },
  ctx: GraphQLContext,
) {
  const [computer] = await db
    .select()
    .from(computers)
    .where(eq(computers.id, args.computerId));
  if (!computer) {
    throw new GraphQLError("Computer not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await requireComputerReadAccess(ctx, computer);

  return listComputerTasks({
    tenantId: computer.tenant_id,
    computerId: computer.id,
    status: parseComputerTaskStatus(args.status),
    limit: args.limit,
  });
}
