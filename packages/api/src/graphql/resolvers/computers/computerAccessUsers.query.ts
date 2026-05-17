import type { GraphQLContext } from "../../context.js";
import {
  db,
  and,
  eq,
  users,
  teams,
  teamUsers,
  computerAssignments,
  snakeToCamel,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import {
  accessSource,
  loadComputerOrThrow,
  toGraphqlComputerAssignment,
} from "./shared.js";

type AccessRow = {
  user: Record<string, unknown>;
  directAssignment: Record<string, unknown> | null;
  teamAssignments: Record<string, unknown>[];
  teams: Record<string, unknown>[];
};

export async function computerAccessUsers(
  _parent: any,
  args: { computerId: string },
  ctx: GraphQLContext,
) {
  const computer = await loadComputerOrThrow(args.computerId);
  await requireTenantAdmin(ctx, computer.tenant_id);

  const byUser = new Map<string, AccessRow>();

  const directRows = await db
    .select()
    .from(computerAssignments)
    .innerJoin(users, eq(users.id, computerAssignments.user_id))
    .where(
      and(
        eq(computerAssignments.tenant_id, computer.tenant_id),
        eq(computerAssignments.computer_id, computer.id),
        eq(computerAssignments.subject_type, "user"),
      ),
    );

  for (const row of directRows) {
    byUser.set(row.users.id, {
      user: row.users,
      directAssignment: row.computer_assignments,
      teamAssignments: [],
      teams: [],
    });
  }

  const teamRows = await db
    .select()
    .from(computerAssignments)
    .innerJoin(teams, eq(teams.id, computerAssignments.team_id))
    .innerJoin(teamUsers, eq(teamUsers.team_id, computerAssignments.team_id))
    .innerJoin(users, eq(users.id, teamUsers.user_id))
    .where(
      and(
        eq(computerAssignments.tenant_id, computer.tenant_id),
        eq(computerAssignments.computer_id, computer.id),
        eq(computerAssignments.subject_type, "team"),
        eq(teamUsers.tenant_id, computer.tenant_id),
      ),
    );

  for (const row of teamRows) {
    const existing = byUser.get(row.users.id) ?? newAccessRow(row.users);
    existing.teamAssignments.push(row.computer_assignments);
    existing.teams.push(row.teams);
    byUser.set(row.users.id, existing);
  }

  return [...byUser.entries()].map(([userId, row]) => ({
    userId,
    user: snakeToCamel(row.user),
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

function newAccessRow(user: Record<string, unknown>): AccessRow {
  return {
    user,
    directAssignment: null,
    teamAssignments: [],
    teams: [],
  };
}
