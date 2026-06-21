import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db as defaultDb } from "../../utils.js";
import { requirePluginTenantAdmin } from "../plugins/shared.js";
import { discoverN8nWorkflows as discover } from "../../../lib/workflows/n8n-discovery.js";

export async function discoverN8nWorkflows(
  _parent: unknown,
  args: { installId: string },
  ctx: GraphQLContext,
  deps: { db?: typeof defaultDb; discover?: typeof discover } = {},
) {
  const { tenantId } = await requirePluginTenantAdmin(ctx);
  try {
    return await (deps.discover ?? discover)(deps.db ?? defaultDb, {
      tenantId,
      installId: args.installId,
    });
  } catch (error) {
    throw new GraphQLError((error as Error).message, {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }
}
