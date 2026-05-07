import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, computers } from "../../utils.js";
import { listComputerEvents } from "../../../lib/computers/events.js";
import { requireComputerReadAccess } from "./shared.js";

export async function computerEvents(
  _parent: any,
  args: { computerId: string; limit?: number | null },
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

  return listComputerEvents({
    tenantId: computer.tenant_id,
    computerId: computer.id,
    limit: args.limit,
  });
}
