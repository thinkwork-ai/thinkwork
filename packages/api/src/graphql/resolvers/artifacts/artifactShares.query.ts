/**
 * Artifact share queries (THINK-208 U3).
 *
 * `artifactShares(artifactId)` — the artifact's active share (0 or 1 rows),
 * visible to any member who passes the same access checks as mint, with
 * creator attribution so a non-creator member sees who shared it.
 * `tenantArtifactShares(tenantId)` — operator-only tenant-wide list.
 *
 * Neither query ever returns a signed token: clients re-obtain the URL via
 * mint's get-or-create (the token is re-derivable from the share id, KTD-1).
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  isNull,
  desc,
  artifacts,
  artifactShares,
  users,
} from "../../utils.js";
import { requireTenantMember, requireTenantAdmin } from "../core/authz.js";
import { assertCanvasAccess } from "../../../lib/artifacts/canvas-access.js";

export interface ArtifactShareRow {
  id: string;
  tenant_id: string;
  artifact_id: string;
  created_by: string;
  created_at: Date;
  revoked_at: Date | null;
  revoked_by: string | null;
}

export function shareToGql(
  row: ArtifactShareRow,
  artifactTitle: string,
  createdByName?: string | null,
) {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    artifactTitle,
    createdBy: row.created_by,
    createdByName: createdByName ?? null,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  };
}

export const artifactShares_ = async (
  _parent: unknown,
  args: { artifactId: string },
  ctx: GraphQLContext,
) => {
  const artifactId = args.artifactId?.trim();
  if (!artifactId) {
    throw new GraphQLError("artifactShares artifactId is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const [row] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, artifactId));
  if (!row) return [];
  // Same gates as mint: tenant membership + the document's read gate (KTD-8).
  await requireTenantMember(ctx, row.tenant_id);
  await assertCanvasAccess(ctx, row, "read");

  const rows = await db
    .select({ share: artifactShares, creatorName: users.name })
    .from(artifactShares)
    .leftJoin(users, eq(artifactShares.created_by, users.id))
    .where(
      and(
        eq(artifactShares.artifact_id, artifactId),
        isNull(artifactShares.revoked_at),
      ),
    );
  return rows.map(({ share, creatorName }) =>
    shareToGql(share as ArtifactShareRow, row.title, creatorName),
  );
};

export const tenantArtifactShares = async (
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
) => {
  const tenantId = args.tenantId?.trim();
  if (!tenantId) {
    throw new GraphQLError("tenantArtifactShares tenantId is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  await requireTenantAdmin(ctx, tenantId);

  const rows = await db
    .select({
      share: artifactShares,
      artifactTitle: artifacts.title,
      creatorName: users.name,
    })
    .from(artifactShares)
    .innerJoin(artifacts, eq(artifactShares.artifact_id, artifacts.id))
    .leftJoin(users, eq(artifactShares.created_by, users.id))
    .where(
      and(
        eq(artifactShares.tenant_id, tenantId),
        isNull(artifactShares.revoked_at),
      ),
    )
    .orderBy(desc(artifactShares.created_at));
  return rows.map(({ share, artifactTitle, creatorName }) =>
    shareToGql(share as ArtifactShareRow, artifactTitle, creatorName),
  );
};
