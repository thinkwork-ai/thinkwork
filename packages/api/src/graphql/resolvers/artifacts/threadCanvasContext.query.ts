/**
 * threadCanvasContext (Living Artifacts THINK-145 U9, R16–R19 / KTD8).
 *
 * The single read seam behind the agent parity tools: given a thread, return
 * its home space, the current canvas part (the `save_canvas` target), the SAVED
 * canvases in the space (name resolution + `list_canvases`, drafts excluded),
 * and the spaces the acting user may save into.
 *
 * Identity (KTD8): the runtime calls this with the shared service secret AND
 * the acting user asserted via `x-principal-id` (apikey auth). We resolve THAT
 * user (`resolveCallerFromAuth`) and gate on their space access — never on the
 * service principal alone. A bare `service` caller (no principal) resolves to a
 * null user and is rejected, so trusted infra cannot read a thread's canvases
 * without naming the user it acts for.
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
import { canAccessSpace } from "../spaces/shared.js";
import {
  getThreadCurrentCanvas,
  listSavedCanvasesInSpace,
  listWritableSpacesForUser,
  resolveThreadSpace,
  type SavedCanvasSummary,
} from "../../../lib/artifacts/saved-canvas-index.js";

interface ThreadCanvasContextArgs {
  threadId: string;
}

export const threadCanvasContext = async (
  _parent: unknown,
  args: ThreadCanvasContextArgs,
  ctx: GraphQLContext,
) => {
  const threadId = requiredString(args.threadId, "threadId");

  const caller = await resolveCallerFromAuth(ctx.auth);
  if (!caller.userId || !caller.tenantId) {
    throw new GraphQLError("Requester user identity required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  const thread = await resolveThreadSpace(threadId);
  if (!thread) {
    throw new GraphQLError("Thread not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await requireTenantMember(ctx, thread.tenantId);
  if (thread.tenantId !== caller.tenantId) {
    throw new GraphQLError("Thread belongs to a different tenant", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  // Saved canvases are visible only when the acting user can access the thread's
  // space (R15). No space, or no space access → empty saved set (the current
  // draft canvas in this thread is still returned for save_canvas).
  let savedCanvases: SavedCanvasSummary[] = [];
  if (thread.spaceId) {
    const canSee = await canAccessSpace(ctx, thread.tenantId, thread.spaceId);
    if (canSee) {
      savedCanvases = await listSavedCanvasesInSpace(
        thread.tenantId,
        thread.spaceId,
      );
    }
  }

  const [currentCanvas, writableSpaces] = await Promise.all([
    getThreadCurrentCanvas(thread.tenantId, threadId),
    listWritableSpacesForUser(thread.tenantId, caller.userId),
  ]);

  return {
    threadId,
    spaceId: thread.spaceId,
    spaceName: thread.spaceName,
    currentCanvas,
    savedCanvases,
    writableSpaces,
  };
};

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GraphQLError(`threadCanvasContext ${field} is required`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return value.trim();
}
