import type { GraphQLContext } from "../../context.js";
import { loadAdminApplet, toAppletPayload } from "./applet.shared.js";

export async function adminApplet(
  _parent: any,
  args: { appId: string },
  ctx: GraphQLContext,
) {
  const loaded = await loadAdminApplet({ appId: args.appId, ctx });
  return toAppletPayload(loaded);
}
