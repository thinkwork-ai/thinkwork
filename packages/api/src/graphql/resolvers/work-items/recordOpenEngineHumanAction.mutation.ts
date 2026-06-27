import type { GraphQLContext } from "../../context.js";
import { recordOpenEngineHumanAction as recordOpenEngineHumanActionRow } from "../../../lib/work-items/work-item-service.js";
import { toGraphqlWorkItemEvent } from "./shared.js";

export async function recordOpenEngineHumanAction(
  _parent: unknown,
  args: { input: Record<string, any> },
  ctx: GraphQLContext,
) {
  const event = await recordOpenEngineHumanActionRow(ctx, args.input ?? {});
  return toGraphqlWorkItemEvent(event as Record<string, unknown>);
}
