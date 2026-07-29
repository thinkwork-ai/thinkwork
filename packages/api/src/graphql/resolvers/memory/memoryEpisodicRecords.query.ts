/**
 * memoryEpisodicRecords — list the session-scoped episodes (and the
 * cross-session reflections filed alongside them) for one user.
 *
 * `memoryRecords` deliberately fans out only over actor-scoped namespaces:
 * episodic records are per-thread and would swamp a cross-thread listing.
 * The Memory settings page still wants them as their own facet, so this is
 * the explicit, separately-paged read for that data.
 *
 * Engines with no episodic facet return `[]` (see
 * `NormalizedInspectService.inspectEpisodic`) — a missing capability is not
 * an error here, the facet is just empty.
 */

import type { GraphQLContext } from "../../context.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";
import { toMemoryRecordRows } from "./memoryRecords.query.js";

const TOTAL_CAP = 500;

export const memoryEpisodicRecords = async (
  _parent: unknown,
  args: {
    tenantId?: string | null;
    userId?: string | null;
    assistantId?: string | null;
    limit?: number | null;
  },
  ctx: GraphQLContext,
) => {
  const { tenantId, userId } = await requireMemoryUserScope(ctx, {
    ...args,
    allowTenantAdmin: true,
  });

  const { inspect: inspectService } = getMemoryServices();
  const records = await inspectService.inspectEpisodic({
    tenantId,
    ownerType: "user",
    ownerId: userId,
    limit: Math.min(args.limit ?? TOTAL_CAP, TOTAL_CAP),
  });

  return toMemoryRecordRows(records, userId);
};
