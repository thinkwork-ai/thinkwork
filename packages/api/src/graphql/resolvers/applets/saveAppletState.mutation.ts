import type { GraphQLContext } from "../../context.js";
import {
  saveAppletStateInner,
  type SaveAppletStateInput,
} from "./applet.shared.js";

export async function saveAppletState(
  _parent: any,
  args: { input: SaveAppletStateInput },
  ctx: GraphQLContext,
) {
  return saveAppletStateInner({ ctx, input: args.input });
}
