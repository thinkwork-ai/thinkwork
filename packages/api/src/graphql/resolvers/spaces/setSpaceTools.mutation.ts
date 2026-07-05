import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  and,
  db,
  eq,
  inArray,
  snakeToCamel,
  spaceMcpServers,
  spaces,
  tenantMcpServers,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import {
  normalizeBuiltInToolSlugs,
  withBuiltInToolPolicy,
  withMcpServerPolicy,
} from "./tools-policy.js";

type SetSpaceToolsInput = {
  tenantId: string;
  spaceId: string;
  builtInToolSlugs: string[];
  mcpServerIds: string[];
};

export async function setSpaceTools(
  _parent: unknown,
  args: { input: SetSpaceToolsInput },
  ctx: GraphQLContext,
) {
  const input = args.input;
  await requireAdminOrServiceCaller(ctx, input.tenantId, "set_space_tools");

  let builtInToolSlugs: string[];
  try {
    builtInToolSlugs = normalizeBuiltInToolSlugs(input.builtInToolSlugs);
  } catch (err) {
    throw new GraphQLError((err as Error).message);
  }

  const [spaceRow] = await db
    .select({
      id: spaces.id,
      tool_policy: spaces.tool_policy,
      mcp_policy: spaces.mcp_policy,
    })
    .from(spaces)
    .where(
      and(eq(spaces.id, input.spaceId), eq(spaces.tenant_id, input.tenantId)),
    );
  if (!spaceRow) {
    throw new GraphQLError("Space not found for tenant");
  }

  const requestedMcpServerIds = Array.from(
    new Set(input.mcpServerIds.map((id) => id.trim()).filter(Boolean)),
  );
  const mcpServerRows =
    requestedMcpServerIds.length > 0
      ? await db
          .select({ id: tenantMcpServers.id, slug: tenantMcpServers.slug })
          .from(tenantMcpServers)
          .where(
            and(
              eq(tenantMcpServers.tenant_id, input.tenantId),
              inArray(tenantMcpServers.id, requestedMcpServerIds),
            ),
          )
      : [];
  const tenantMcpServerIds = new Set(mcpServerRows.map((server) => server.id));
  const missingMcpServerId = requestedMcpServerIds.find(
    (id) => !tenantMcpServerIds.has(id),
  );
  if (missingMcpServerId) {
    throw new GraphQLError("MCP server not found for tenant");
  }

  const mcpSlugsById = new Map(
    mcpServerRows.map((server) => [server.id, server.slug]),
  );
  const mcpServerSlugs = requestedMcpServerIds
    .map((id) => mcpSlugsById.get(id))
    .filter((slug): slug is string => Boolean(slug));

  // THINK-173 U10 (R14/R16): the Space Tool Library's MCP half is
  // read-only in v1 — space-level connection grants have no folder
  // semantics until THINK-174's space-source work, and spaceMcpServers
  // is retired for capability purposes (this was its only inserter).
  // Built-in tool policy editing stays live; requesting MCP servers is
  // a loud error, never a silent drop.
  if (requestedMcpServerIds.length > 0) {
    throw new GraphQLError(
      "The Space Tool Library is read-only for MCP servers: space-level connection grants are being replaced by workspace capability folders (THINK-173). Assign connections on the agent instead.",
      { extensions: { code: "SPACE_TOOLS_READ_ONLY" } },
    );
  }

  const [updatedSpace] = await db.transaction(async (tx) => {
    return tx
      .update(spaces)
      .set({
        tool_policy: withBuiltInToolPolicy(
          spaceRow.tool_policy,
          builtInToolSlugs,
        ),
        mcp_policy: withMcpServerPolicy(spaceRow.mcp_policy, mcpServerSlugs),
        updated_at: new Date(),
      })
      .where(
        and(eq(spaces.id, input.spaceId), eq(spaces.tenant_id, input.tenantId)),
      )
      .returning();
  });

  return snakeToCamel(updatedSpace);
}
