/**
 * resetWikiCursor — admin-only replay control.
 *
 * - `force=false` (default): clear the compile cursor for (tenant, owner).
 *   Next compile re-reads all changed records since the beginning of time.
 *   Idempotent compile upserts mean this is safe to run anytime.
 * - `force=true`: additionally archive every active page in the scope so
 *   the next compile rebuilds from scratch instead of merging onto
 *   existing pages. Destructive — use only when the compiler output is
 *   known-bad and you want to start over.
 */

import type { GraphQLContext } from "../../context.js";
import { resetScopedWikiRebuild } from "../../../lib/wiki/rebuild-runner.js";
import { resetCursor } from "../../../lib/wiki/repository.js";
import { assertCanAdminWikiScope } from "./auth.js";

interface ResetWikiCursorArgs {
  tenantId: string;
  userId?: string | null;
  ownerId?: string | null;
  force?: boolean | null;
  dryRun?: boolean | null;
  includeBrain?: boolean | null;
}

export const resetWikiCursor = async (
  _parent: unknown,
  args: ResetWikiCursorArgs,
  ctx: GraphQLContext,
) => {
  const { tenantId, userId } = await assertCanAdminWikiScope(ctx, args);

  if (args.force) {
    const reset = await resetScopedWikiRebuild({
      tenantId,
      ownerId: userId,
      dryRun: args.dryRun === true,
      includeBrain: args.includeBrain === true,
    });
    return {
      tenantId: args.tenantId,
      userId,
      ownerId: args.ownerId ?? userId,
      cursorCleared: reset.cursorCleared,
      pagesArchived: reset.pagesArchived,
      dryRun: reset.dryRun,
      brainIncluded: reset.brainIncluded,
      impact: reset,
    };
  }

  await resetCursor({ tenantId, ownerId: userId });

  return {
    tenantId: args.tenantId,
    userId,
    ownerId: args.ownerId ?? userId,
    cursorCleared: true,
    pagesArchived: 0,
    dryRun: false,
    brainIncluded: false,
    impact: null,
  };
};
