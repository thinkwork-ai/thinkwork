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

  const [updatedSpace] = await db.transaction(async (tx) => {
    await tx
      .delete(spaceMcpServers)
      .where(
        and(
          eq(spaceMcpServers.tenant_id, input.tenantId),
          eq(spaceMcpServers.space_id, input.spaceId),
        ),
      );

    if (requestedMcpServerIds.length > 0) {
      await tx.insert(spaceMcpServers).values(
        requestedMcpServerIds.map((mcpServerId) => ({
          tenant_id: input.tenantId,
          space_id: input.spaceId,
          mcp_server_id: mcpServerId,
          enabled: true,
          config: null,
        })),
      );
    }

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
