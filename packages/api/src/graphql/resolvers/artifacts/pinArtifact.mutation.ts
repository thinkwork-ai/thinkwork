/**
 * pinArtifact (Living Artifacts THINK-145 U4, R11).
 *
 * Atomically snapshots the persisted canvas head to a content-addressed,
 * write-once revision key, appends an `artifact_versions` row (version =
 * head_version + 1), and bumps the head pointer — all guarded by the KTD6
 * `head_write_seq` conditional UPDATE so a concurrent head change never loses.
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, artifacts } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
// U2 unifies via assertCanvasAccess; U4 uses a minimal inline membership check.
import { canAccessSpace } from "../spaces/shared.js";
import {
  isCanvasArtifact,
  pinHeadToVersion,
  type CanvasArtifactRow,
} from "../../../lib/artifacts/canvas-lifecycle.js";
import { artifactToCamelWithPayload } from "./payload.js";

export const pinArtifact = async (
  _parent: unknown,
  args: { artifactId: string },
  ctx: GraphQLContext,
) => {
  const artifactId = args.artifactId?.trim();
  if (!artifactId) {
    throw new GraphQLError("pinArtifact artifactId is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

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
    throw new GraphQLError("pinArtifact is only valid for GenUI canvases", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  // Saved canvases (non-null space) require space membership to pin; draft
  // canvases fall back to tenant membership (checked above). U2 unifies this.
  if (row.space_id) {
    const canAccess = await canAccessSpace(ctx, row.tenant_id, row.space_id);
    if (!canAccess) {
      throw new GraphQLError("You are not a member of the canvas space", {
        extensions: { code: "FORBIDDEN" },
      });
    }
  }

  const updated = await pinHeadToVersion({
    row: row as unknown as CanvasArtifactRow,
    userId: caller.userId,
  });
  return artifactToCamelWithPayload(
    updated as unknown as Parameters<typeof artifactToCamelWithPayload>[0],
  );
};
