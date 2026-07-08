/**
 * Document change log (THINK-155 follow-up): one pinned version's rendered
 * HTML, read from its content-addressed render pin
 * (`artifactRenderKey({..., revision: contentHash})`, written by
 * `pinDocumentHead`). Precise single-version fetch so the history panel never
 * hydrates every snapshot at once.
 *
 * Access gate mirrors `artifact(id:)` + `Artifact.renderHtml`: tenant member,
 * canvas/document access (R15), document-kind rows only — agent-authored HTML
 * is only ever served through gated resolvers, never presigned URLs.
 */

import type { GraphQLContext } from "../../context.js";
import { and, artifactVersions, db, eq, artifacts } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { assertCanvasAccess } from "../../../lib/artifacts/canvas-access.js";
import { isDocumentMetadata } from "../../../lib/artifacts/document-emission.js";
import {
  artifactRenderKey,
  readArtifactPayloadFromS3,
} from "../../../lib/artifacts/payload-storage.js";

export const documentVersionRender = async (
  _parent: any,
  args: { artifactId: string; version: number },
  ctx: GraphQLContext,
): Promise<string | null> => {
  const [row] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, args.artifactId));
  if (!row) return null;
  await requireTenantMember(ctx, row.tenant_id);
  await assertCanvasAccess(ctx, row, "read");
  if (!isDocumentMetadata(row.metadata)) return null;

  const [version] = await db
    .select({ content_hash: artifactVersions.content_hash })
    .from(artifactVersions)
    .where(
      and(
        eq(artifactVersions.tenant_id, row.tenant_id),
        eq(artifactVersions.artifact_id, row.id),
        eq(artifactVersions.version, args.version),
      ),
    )
    .limit(1);
  if (!version) return null;

  const key = artifactRenderKey({
    tenantId: row.tenant_id,
    artifactId: row.id,
    revision: version.content_hash,
  });
  try {
    return await readArtifactPayloadFromS3({ tenantId: row.tenant_id, key });
  } catch (err) {
    console.error(
      `[documentVersionRender] read failed for ${row.id} v${args.version}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
};
