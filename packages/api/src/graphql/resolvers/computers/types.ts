import {
  db,
  eq,
  users,
  agents,
  agentTemplates,
  computers,
  teams,
  agentToCamel,
  computerToCamel,
  snakeToCamel,
  templateToCamel,
} from "../../utils.js";
import { withGraphqlAgentRuntime } from "../agents/runtime.js";

export const computerTypeResolvers = {
  owner: async (parent: any) => {
    const ownerUserId = parent.ownerUserId ?? parent.owner_user_id;
    if (!ownerUserId) return null;
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, ownerUserId));
    return row ? snakeToCamel(row) : null;
  },
  template: async (parent: any) => {
    const templateId = parent.templateId ?? parent.template_id;
    if (!templateId) return null;
    const [row] = await db
      .select()
      .from(agentTemplates)
      .where(eq(agentTemplates.id, templateId));
    return row ? withGraphqlAgentRuntime(templateToCamel(row)) : null;
  },
  sourceAgent: async (parent: any) => {
    const agentId = parent.migratedFromAgentId ?? parent.migrated_from_agent_id;
    if (!agentId) return null;
    const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
    return row ? agentToCamel(row) : null;
  },
};

export const computerAssignmentTypeResolvers = {
  computer: async (parent: any) => {
    const computerId = parent.computerId ?? parent.computer_id;
    if (!computerId) return null;
    const [row] = await db
      .select()
      .from(computers)
      .where(eq(computers.id, computerId));
    return row ? computerToCamel(row) : null;
  },
  user: async (parent: any) => {
    const userId = parent.userId ?? parent.user_id;
    if (!userId) return null;
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    return row ? snakeToCamel(row) : null;
  },
  team: async (parent: any) => {
    const teamId = parent.teamId ?? parent.team_id;
    if (!teamId) return null;
    const [row] = await db.select().from(teams).where(eq(teams.id, teamId));
    return row ? snakeToCamel(row) : null;
  },
  assignedBy: async (parent: any) => {
    const userId = parent.assignedByUserId ?? parent.assigned_by_user_id;
    if (!userId) return null;
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    return row ? snakeToCamel(row) : null;
  },
};
