import type { GraphQLContext } from "../../context.js";
import { loadAppletState } from "./applet.shared.js";

export async function appletState(
  _parent: any,
  args: { appId: string; instanceId: string; key: string },
  ctx: GraphQLContext,
) {
  return loadAppletState({ ctx, ...args });
}
