import type { GraphQLContext } from "../../context.js";
import {
  saveAppletInner,
  type SaveAppletInput,
} from "./applet.shared.js";

export async function regenerateApplet(
  _parent: any,
  args: { input: SaveAppletInput },
  ctx: GraphQLContext,
) {
  return saveAppletInner({ ctx, input: args.input, regenerate: true });
}
