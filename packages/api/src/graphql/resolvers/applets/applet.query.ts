import type { GraphQLContext } from "../../context.js";
import { loadApplet, toAppletPayload } from "./applet.shared.js";

export async function applet(
  _parent: any,
  args: { appId: string },
  ctx: GraphQLContext,
) {
  const loaded = await loadApplet({ appId: args.appId, ctx });
  return toAppletPayload(loaded);
}
