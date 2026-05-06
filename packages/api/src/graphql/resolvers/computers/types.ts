import {
  db,
  eq,
  users,
  agentTemplates,
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
};
