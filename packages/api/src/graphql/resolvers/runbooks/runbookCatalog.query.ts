import type { GraphQLContext } from "../../context.js";
import { listRunbookCatalog } from "../../../lib/runbooks/catalog.js";
import { resolveRunbookCaller } from "./shared.js";

export async function runbookCatalog(
  _parent: any,
  _args: Record<string, never>,
  ctx: GraphQLContext,
) {
  const { tenantId } = await resolveRunbookCaller(ctx);
  return listRunbookCatalog({ tenantId });
}
