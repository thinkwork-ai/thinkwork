import type { GraphQLContext } from "../../context.js";
import {
  and,
  db,
  desc,
  eq,
  inArray,
  ne,
  piExtensionAssignments,
  piExtensionSources,
  piExtensionVersions,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import {
  type PiExtensionAssignmentRow,
  toPiExtensionGraphql,
} from "./shared.js";

export async function piExtensions(
  _parent: unknown,
  args: {
    tenantId: string;
    includeRejected?: boolean | null;
    includeFailed?: boolean | null;
  },
  ctx: GraphQLContext,
) {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "pi_extensions:read");

  const conditions = [eq(piExtensionVersions.tenant_id, args.tenantId)];
  if (args.includeRejected === false) {
    conditions.push(ne(piExtensionVersions.status, "rejected"));
  }
  if (args.includeFailed === false) {
    conditions.push(ne(piExtensionVersions.status, "failed_verification"));
  }

  const rows = await db
    .select({
      version: piExtensionVersions,
      source: piExtensionSources,
    })
    .from(piExtensionVersions)
    .innerJoin(
      piExtensionSources,
      eq(piExtensionVersions.source_id, piExtensionSources.id),
    )
    .where(and(...conditions))
    .orderBy(desc(piExtensionVersions.updated_at));

  const versionIds = rows.map((row) => row.version.id);
  const assignmentsByVersionId = await loadAssignmentsByVersionId(
    args.tenantId,
    versionIds,
  );

  return rows.map((row) =>
    toPiExtensionGraphql({
      version: row.version,
      source: row.source,
      assignments: assignmentsByVersionId.get(row.version.id) ?? [],
    }),
  );
}

async function loadAssignmentsByVersionId(
  tenantId: string,
  versionIds: string[],
): Promise<Map<string, PiExtensionAssignmentRow[]>> {
  if (versionIds.length === 0) return new Map();

  const rows = await db
    .select()
    .from(piExtensionAssignments)
    .where(
      and(
        eq(piExtensionAssignments.tenant_id, tenantId),
        inArray(piExtensionAssignments.version_id, versionIds),
      ),
    );

  const byVersionId = new Map<string, PiExtensionAssignmentRow[]>();
  for (const row of rows) {
    const existing = byVersionId.get(row.version_id) ?? [];
    existing.push(row);
    byVersionId.set(row.version_id, existing);
  }
  return byVersionId;
}
