/**
 * saveCanvas (Living Artifacts THINK-145 U4, R10/R12/R15).
 *
 * Saving a canvas is a status flip + naming + space assignment — never a copy
 * (the promote-copy path is retired for canvases). First-time save is a pure
 * flip via a single conditional UPDATE (`WHERE status = 'draft'`), so a
 * double-click produces exactly one saved artifact: the loser sees zero rows
 * updated and returns the already-saved row idempotently (no version, no
 * duplicate).
 *
 * Re-saving an already-final canvas auto-pins the prior head as a version
 * before applying the naming/space change (KTD3 check-in rule) — the mechanism
 * behind AE3. The U8 check-in path reuses {@link pinHeadToVersion}.
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { and, artifacts, db, eq } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
// U2 unifies via assertCanvasAccess; U4 uses a minimal inline membership check.
import { canAccessSpace } from "../spaces/shared.js";
import {
  boundedCanvasText,
  isCanvasArtifact,
  pinHeadToVersion,
  type CanvasArtifactRow,
} from "../../../lib/artifacts/canvas-lifecycle.js";
import { artifactToCamelWithPayload } from "./payload.js";

interface SaveCanvasArgs {
  artifactId: string;
  title: string;
  spaceId: string;
}

export const saveCanvas = async (
  _parent: unknown,
  args: SaveCanvasArgs,
  ctx: GraphQLContext,
) => {
  const artifactId = requiredString(args.artifactId, "artifactId");
  const spaceId = requiredString(args.spaceId, "spaceId");
  const title = boundedCanvasText(requiredString(args.title, "title"), 160);

  const caller = await resolveCallerFromAuth(ctx.auth);
  if (!caller.userId || !caller.tenantId) {
    throw new GraphQLError("Requester user identity required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  const [row] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, artifactId));
  if (!row) {
    throw new GraphQLError("Canvas artifact not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await requireTenantMember(ctx, row.tenant_id);
  if (row.tenant_id !== caller.tenantId) {
    throw new GraphQLError("Canvas belongs to a different tenant", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  if (!isCanvasArtifact(row.metadata)) {
    throw new GraphQLError("saveCanvas is only valid for GenUI canvases", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  // R15: saving requires membership in the space being assigned.
  // U2 unifies via assertCanvasAccess (member-or-above); U4's inline check is
  // canAccessSpace, which is role-agnostic but sufficient for the lifecycle.
  const canAccess = await canAccessSpace(ctx, row.tenant_id, spaceId);
  if (!canAccess) {
    throw new GraphQLError("You are not a member of the target space", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  const canvasRow = row as unknown as CanvasArtifactRow;

  if (row.status === "draft") {
    // First-time save: pure conditional flip. Double-click safe — only one
    // update matches `status = 'draft'`.
    const [flipped] = await db
      .update(artifacts)
      .set({
        status: "final",
        title,
        space_id: spaceId,
        updated_at: new Date(),
      })
      .where(and(eq(artifacts.id, artifactId), eq(artifacts.status, "draft")))
      .returning();
    if (flipped) return artifactToCamelWithPayload(flipped);

    // Lost the flip race — someone saved concurrently. Return the current
    // saved row; do NOT auto-pin (this is the same save, not an edit re-save).
    const [current] = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, artifactId));
    if (!current) {
      throw new GraphQLError("Canvas artifact not found", {
        extensions: { code: "NOT_FOUND" },
      });
    }
    return artifactToCamelWithPayload(current);
  }

  if (row.status === "final") {
    // Re-save of an already-saved canvas: auto-pin the prior head as a version
    // (check-in rule) and apply the naming/space change in the same guarded
    // UPDATE (KTD3 + KTD6).
    const updated = await pinHeadToVersion({
      row: canvasRow,
      userId: caller.userId,
      extraUpdates: { title, space_id: spaceId },
    });
    return artifactToCamelWithPayload(
      updated as unknown as Parameters<typeof artifactToCamelWithPayload>[0],
    );
  }

  throw new GraphQLError(
    `Canvas cannot be saved from status '${row.status}'`,
    { extensions: { code: "BAD_USER_INPUT" } },
  );
};

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GraphQLError(`saveCanvas ${field} is required`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return value.trim();
}
