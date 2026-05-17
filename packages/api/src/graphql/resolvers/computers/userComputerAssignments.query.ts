import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  and,
  eq,
  ne,
  users,
  teams,
  computers,
  teamUsers,
  computerAssignments,
  snakeToCamel,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import {
  accessSource,
  toGraphqlComputer,
  toGraphqlComputerAssignment,
} from "./shared.js";

type AssignmentRow = {
  computer: typeof computers.$inferSelect;
  directAssignment: Record<string, unknown> | null;
  teamAssignments: Record<string, unknown>[];
  teams: Record<string, unknown>[];
};

export async function userComputerAssignments(
  _parent: any,
  args: { userId: string },
  ctx: GraphQLContext,
) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, args.userId))
    .limit(1);
  if (!user?.tenant_id) {
    throw new GraphQLError("User not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await requireTenantAdmin(ctx, user.tenant_id);

  const byComputer = new Map<string, AssignmentRow>();

  const directRows = await db
    .select()
    .from(computerAssignments)
    .innerJoin(computers, eq(computers.id, computerAssignments.computer_id))
    .where(
      and(
        eq(computerAssignments.tenant_id, user.tenant_id),
        eq(computerAssignments.subject_type, "user"),
        eq(computerAssignments.user_id, user.id),
        ne(computers.status, "archived"),
      ),
    );

  for (const row of directRows) {
    byComputer.set(row.computers.id, {
      computer: row.computers,
      directAssignment: row.computer_assignments,
      teamAssignments: [],
      teams: [],
    });
  }

  const teamRows = await db
    .select()
    .from(teamUsers)
    .innerJoin(teams, eq(teams.id, teamUsers.team_id))
    .innerJoin(computerAssignments, eq(computerAssignments.team_id, teams.id))
    .innerJoin(computers, eq(computers.id, computerAssignments.computer_id))
    .where(
      and(
        eq(teamUsers.tenant_id, user.tenant_id),
        eq(teamUsers.user_id, user.id),
        eq(computerAssignments.tenant_id, user.tenant_id),
        eq(computerAssignments.subject_type, "team"),
        ne(computers.status, "archived"),
      ),
    );

  for (const row of teamRows) {
    const existing =
      byComputer.get(row.computers.id) ?? newAssignmentRow(row.computers);
    existing.teamAssignments.push(row.computer_assignments);
    existing.teams.push(row.teams);
    byComputer.set(row.computers.id, existing);
  }

  return [...byComputer.entries()].map(([computerId, row]) => ({
    computerId,
    computer: toGraphqlComputer(row.computer),
    accessSource: accessSource({
      direct: Boolean(row.directAssignment),
      team: row.teamAssignments.length > 0,
    }),
    directAssignment: row.directAssignment
      ? toGraphqlComputerAssignment(row.directAssignment)
      : null,
    teamAssignments: row.teamAssignments.map((assignment) =>
      toGraphqlComputerAssignment(assignment),
    ),
    teams: row.teams.map((team) => snakeToCamel(team)),
  }));
}

function newAssignmentRow(
  computer: typeof computers.$inferSelect,
): AssignmentRow {
  return {
    computer,
    directAssignment: null,
    teamAssignments: [],
    teams: [],
  };
}
