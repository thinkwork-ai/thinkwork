import type { GraphQLContext } from "../../context.js";
import { db, eq, computers } from "../../utils.js";
import { requireComputerReadAccess, toGraphqlComputer } from "./shared.js";

export async function computer(
  _parent: any,
  args: { id: string },
  ctx: GraphQLContext,
) {
  const [row] = await db
    .select()
    .from(computers)
    .where(eq(computers.id, args.id));
  if (!row) return null;
  await requireComputerReadAccess(ctx, row);
  return toGraphqlComputer(row);
}
