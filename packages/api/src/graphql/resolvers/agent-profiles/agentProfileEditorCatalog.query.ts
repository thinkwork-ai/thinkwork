import { BUILTIN_TOOL_SLUGS } from "../../../lib/builtin-tool-slugs.js";
import type { GraphQLContext } from "../../context.js";
import {
  asc,
  db,
  eq,
  modelCatalog,
  skillCatalog,
  spaces,
  tenantBuiltinTools,
  tenantMcpServers,
  snakeToCamel,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { toGraphqlSpace } from "../spaces/shared.js";
import { ensureBuiltInAgentProfiles } from "./shared.js";

const DEFAULT_AGENT_PROFILE_BUILTIN_TOOLS = Array.from(
  new Set([...BUILTIN_TOOL_SLUGS, "execute_code", "bash"]),
);

export async function agentProfileEditorCatalog(
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
) {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "agent_profiles:read");
  await ensureBuiltInAgentProfiles(args.tenantId);

  const [models, spaceRows, skillRows, builtinToolRows, mcpServerRows] =
    await Promise.all([
      db
        .select()
        .from(modelCatalog)
        .where(eq(modelCatalog.is_available, true))
        .orderBy(asc(modelCatalog.display_name)),
      db
        .select()
        .from(spaces)
        .where(eq(spaces.tenant_id, args.tenantId))
        .orderBy(asc(spaces.name)),
      db
        .select({
          slug: skillCatalog.slug,
          displayName: skillCatalog.display_name,
          description: skillCatalog.description,
          category: skillCatalog.category,
          icon: skillCatalog.icon,
          tags: skillCatalog.tags,
        })
        .from(skillCatalog)
        .where(eq(skillCatalog.tenant_id, args.tenantId))
        .orderBy(asc(skillCatalog.display_name)),
      db
        .select({ toolSlug: tenantBuiltinTools.tool_slug })
        .from(tenantBuiltinTools)
        .where(eq(tenantBuiltinTools.tenant_id, args.tenantId))
        .orderBy(asc(tenantBuiltinTools.tool_slug)),
      db
        .select()
        .from(tenantMcpServers)
        .where(eq(tenantMcpServers.tenant_id, args.tenantId))
        .orderBy(asc(tenantMcpServers.name)),
    ]);

  const builtInTools = Array.from(
    new Set([
      ...DEFAULT_AGENT_PROFILE_BUILTIN_TOOLS,
      ...builtinToolRows.map((row) => row.toolSlug),
    ]),
  );

  return {
    models: models.map(snakeToCamel),
    spaces: spaceRows.map(toGraphqlSpace),
    skills: skillRows,
    builtInTools,
    mcpServers: mcpServerRows.map(snakeToCamel),
  };
}
