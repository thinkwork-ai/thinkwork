import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  and,
  eq,
  inArray,
  users,
  computers,
  computerAssignments,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { toGraphqlComputerAssignment } from "./shared.js";

export async function setUserComputerAssignments(
  _parent: any,
  args: {
    input: { userId: string; computerIds: string[]; role?: string | null };
  },
  ctx: GraphQLContext,
) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, args.input.userId))
    .limit(1);
  if (!user?.tenant_id) {
    throw new GraphQLError("User not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await requireTenantAdmin(ctx, user.tenant_id);
  const assignedByUserId = await resolveCallerUserId(ctx);

  const computerIds = [...new Set(args.input.computerIds ?? [])];
  const rows =
    computerIds.length > 0
      ? await db
          .select()
          .from(computers)
          .where(
            and(
              inArray(computers.id, computerIds),
              eq(computers.tenant_id, user.tenant_id),
            ),
          )
      : [];

  if (rows.length !== computerIds.length) {
    throw new GraphQLError("One or more Computers were not found in tenant", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const values = rows.map((computer) => ({
    tenant_id: user.tenant_id!,
    computer_id: computer.id,
    subject_type: "user",
    user_id: user.id,
    team_id: null,
    role: args.input.role || "member",
    assigned_by_user_id: assignedByUserId,
    updated_at: new Date(),
  }));

  const assignments = await db.transaction(async (tx) => {
    await tx
      .delete(computerAssignments)
      .where(
        and(
          eq(computerAssignments.tenant_id, user.tenant_id!),
          eq(computerAssignments.subject_type, "user"),
          eq(computerAssignments.user_id, user.id),
        ),
      );
    if (values.length === 0) return [];
    return tx.insert(computerAssignments).values(values).returning();
  });

  return assignments.map((assignment) =>
    toGraphqlComputerAssignment(assignment),
  );
}
