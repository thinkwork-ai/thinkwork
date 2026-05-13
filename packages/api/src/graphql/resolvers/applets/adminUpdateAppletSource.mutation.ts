import type { GraphQLContext } from "../../context.js";
import {
  adminUpdateAppletSourceInner,
  type SaveAppletPayload,
} from "./applet.shared.js";

interface AdminUpdateAppletSourceInput {
  appId: string;
  source: string;
}

export async function adminUpdateAppletSource(
  _parent: any,
  args: { input: AdminUpdateAppletSourceInput },
  ctx: GraphQLContext,
): Promise<SaveAppletPayload> {
  return adminUpdateAppletSourceInner({
    ctx,
    appId: args.input.appId,
    source: args.input.source,
  });
}
