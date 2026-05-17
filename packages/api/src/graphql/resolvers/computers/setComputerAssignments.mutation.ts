import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, computerAssignments } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  loadComputerOrThrow,
  parseAssignmentSubjectType,
  requireTenantTeam,
  requireTenantUser,
  toGraphqlComputerAssignment,
} from "./shared.js";

type AssignmentInput = {
  subjectType: string;
  userId?: string | null;
  teamId?: string | null;
  role?: string | null;
};

export async function setComputerAssignments(
  _parent: any,
  args: { input: { computerId: string; assignments: AssignmentInput[] } },
  ctx: GraphQLContext,
) {
  const computer = await loadComputerOrThrow(args.input.computerId);
  await requireTenantAdmin(ctx, computer.tenant_id);
  const assignedByUserId = await resolveCallerUserId(ctx);

  const values: (typeof computerAssignments.$inferInsert)[] = [];
  const seen = new Set<string>();
  for (const assignment of args.input.assignments ?? []) {
    const subjectType = parseAssignmentSubjectType(assignment.subjectType);
    if (subjectType === "user") {
      if (!assignment.userId || assignment.teamId) {
        throw new GraphQLError("User assignment requires userId only", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }
      const key = `user:${assignment.userId}`;
      if (seen.has(key)) throw duplicateAssignmentError();
      seen.add(key);
      await requireTenantUser(computer.tenant_id, assignment.userId);
      values.push({
        tenant_id: computer.tenant_id,
        computer_id: computer.id,
        subject_type: "user",
        user_id: assignment.userId,
        team_id: null,
        role: assignment.role || "member",
        assigned_by_user_id: assignedByUserId,
        updated_at: new Date(),
      });
      continue;
    }

    if (!assignment.teamId || assignment.userId) {
      throw new GraphQLError("Team assignment requires teamId only", {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    const key = `team:${assignment.teamId}`;
    if (seen.has(key)) throw duplicateAssignmentError();
    seen.add(key);
    await requireTenantTeam(computer.tenant_id, assignment.teamId);
    values.push({
      tenant_id: computer.tenant_id,
      computer_id: computer.id,
      subject_type: "team",
      user_id: null,
      team_id: assignment.teamId,
      role: assignment.role || "member",
      assigned_by_user_id: assignedByUserId,
      updated_at: new Date(),
    });
  }

  const rows = await db.transaction(async (tx) => {
    await tx
      .delete(computerAssignments)
      .where(eq(computerAssignments.computer_id, computer.id));
    if (values.length === 0) return [];
    return tx.insert(computerAssignments).values(values).returning();
  });

  return rows.map((row) => toGraphqlComputerAssignment(row));
}

function duplicateAssignmentError() {
  return new GraphQLError("Duplicate Computer assignment target", {
    extensions: { code: "BAD_USER_INPUT" },
  });
}
