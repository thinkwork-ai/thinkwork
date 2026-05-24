import type { GraphQLContext } from "../../context.js";
import {
  db,
  and,
  eq,
  ne,
  computers,
  computerAssignments,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { toGraphqlComputer } from "./shared.js";

export async function assignedComputers(
  _parent: any,
  _args: any,
  ctx: GraphQLContext,
) {
  const caller = await resolveCaller(ctx);
  if (!caller.userId || !caller.tenantId) return [];

  const directRows = await db
    .select()
    .from(computerAssignments)
    .innerJoin(computers, eq(computers.id, computerAssignments.computer_id))
    .where(
      and(
        eq(computerAssignments.tenant_id, caller.tenantId),
        eq(computerAssignments.subject_type, "user"),
        eq(computerAssignments.user_id, caller.userId),
        ne(computers.status, "archived"),
      ),
    );

  const byId = new Map<string, typeof computers.$inferSelect>();
  for (const row of directRows) {
    byId.set(row.computers.id, row.computers);
  }

  return [...byId.values()].map((row) => toGraphqlComputer(row));
}
