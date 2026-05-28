import type { GraphQLContext } from "../../context.js";
import {
  loadPinnedThreads,
  requireThreadPinCaller,
} from "./threadPins.shared.js";

export async function pinnedThreads(
  _parent: any,
  args: { tenantId: string; limit?: number | null },
  ctx: GraphQLContext,
) {
  const caller = await requireThreadPinCaller(ctx, args.tenantId);
  return loadPinnedThreads({ ...caller, limit: args.limit });
}
