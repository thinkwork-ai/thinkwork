import type { GraphQLContext } from "../../context.js";
import {
  loadDashboardArtifact,
  toDashboardArtifactPayload,
} from "./dashboardArtifact.shared.js";

export async function dashboardArtifact(
  _parent: any,
  args: { id: string },
  ctx: GraphQLContext,
) {
  const loaded = await loadDashboardArtifact({ id: args.id, ctx });
  return toDashboardArtifactPayload(loaded);
}
