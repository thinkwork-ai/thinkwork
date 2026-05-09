import type { GraphQLContext } from "../../context.js";
import { listApplets } from "./applet.shared.js";

export async function applets(
  _parent: any,
  args: { cursor?: string | null; limit?: number | null },
  ctx: GraphQLContext,
) {
  return listApplets({ ctx, cursor: args.cursor, limit: args.limit });
}
