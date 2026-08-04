/**
 * Card self-heal (THINK-155 follow-up): resolve the LIVING document by its
 * logical documentId (`metadata.documentId`). Thread cards record the
 * artifactId that existed at emit time; when that row is gone (a fork cleaned
 * up, a re-homed document) the card falls back to this query so history keeps
 * opening the living document.
 *
 * Access gate mirrors `artifact(id:)`: tenant member + canvas/document access.
 */

import type { GraphQLContext } from "../../context.js";
import { and, artifacts, db, desc, eq, inArray, sql } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { assertCanvasAccess } from "../../../lib/artifacts/canvas-access.js";
import { DOCUMENT_METADATA_KIND } from "../../../lib/artifacts/document-emission.js";
import { artifactToCamelWithPayload } from "./payload.js";

export const documentArtifact = async (
  _parent: any,
  args: { documentId: string },
  ctx: GraphQLContext,
) => {
  const [row] = await db
    .select()
    .from(artifacts)
    .where(
      and(
        inArray(artifacts.status, ["draft", "final"]),
        sql`${artifacts.metadata}->>'kind' = ${DOCUMENT_METADATA_KIND}`,
        sql`${artifacts.metadata}->>'documentId' = ${args.documentId}`,
      ),
    )
    .orderBy(desc(artifacts.updated_at))
    .limit(1);
  if (!row) return null;
  await requireTenantMember(ctx, row.tenant_id);
  await assertCanvasAccess(ctx, row, "read");
  return artifactToCamelWithPayload(row);
};
