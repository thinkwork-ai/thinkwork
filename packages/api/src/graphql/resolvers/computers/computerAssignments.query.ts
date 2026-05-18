import type { GraphQLContext } from "../../context.js";
import { db, eq, computerAssignments as assignments } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { loadComputerOrThrow, toGraphqlComputerAssignment } from "./shared.js";

export async function computerAssignments(
  _parent: any,
  args: { computerId: string },
  ctx: GraphQLContext,
) {
  const computer = await loadComputerOrThrow(args.computerId);
  await requireAdminOrServiceCaller(ctx, computer.tenant_id, "computer_assignments");

  const rows = await db
    .select()
    .from(assignments)
    .where(eq(assignments.computer_id, computer.id));
  return rows.map((row) => toGraphqlComputerAssignment(row));
}
