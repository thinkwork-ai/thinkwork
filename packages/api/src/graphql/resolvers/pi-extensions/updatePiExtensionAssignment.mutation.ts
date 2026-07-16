import type { GraphQLContext } from "../../context.js";
import {
  and,
  db,
  eq,
  inArray,
  isNull,
  ne,
  piExtensionAssignments,
  piExtensionVersions,
  sql,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  badInput,
  assertVersionCanBeAssigned,
  loadPiExtensionGraphql,
  normalizeAssignmentTarget,
  normalizeGrantedPermissions,
  notFound,
} from "./review-shared.js";

interface UpdatePiExtensionAssignmentArgs {
  input: {
    tenantId: string;
    versionId: string;
    targetType: string;
    agentProfileId?: string | null;
    enabled?: boolean | null;
    grantedPermissions?: unknown;
  };
}

export async function updatePiExtensionAssignment(
  _parent: unknown,
  args: UpdatePiExtensionAssignmentArgs,
  ctx: GraphQLContext,
) {
  const { tenantId, versionId } = args.input;
  await requireAdminOrServiceCaller(ctx, tenantId, "pi_extensions:assign");
  const actorId = await resolveCallerUserId(ctx);
  const target = normalizeAssignmentTarget(args.input);
  const enabled = args.input.enabled ?? true;
  const now = new Date();

  const extension = await db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(piExtensionVersions)
      .where(
        and(
          eq(piExtensionVersions.tenant_id, tenantId),
          eq(piExtensionVersions.id, versionId),
        ),
      );
    if (!version) throw notFound("Pi extension version not found");
    assertVersionCanBeAssigned(version, enabled);

    if (target.targetType === "agent_profile") {
      // Subagent-folders U11: profile-targeted extension assignments are
      // retired. Sub-agent profiles are workspace folders assembled from
      // the capabilities manifest — the dispatch payload no longer carries
      // per-profile extension lists, so a profile-scoped assignment could
      // never load. (The uuid FK also cannot reference retired rows.)
      throw badInput(
        "Sub-agent-scoped Pi extension assignments are retired — assign the extension at agent scope",
      );
    }

    if (!enabled) {
      await tx
        .update(piExtensionAssignments)
        .set({ enabled: false, updated_at: now })
        .where(
          and(
            eq(piExtensionAssignments.tenant_id, tenantId),
            eq(piExtensionAssignments.version_id, versionId),
            eq(piExtensionAssignments.target_type, target.targetType),
            isNull(piExtensionAssignments.agent_profile_id),
          ),
        );
    } else {
      await disablePreviousAssignments({
        tx,
        tenantId,
        versionId,
        sourceId: version.source_id,
        now,
      });
      const grantedPermissions = normalizeGrantedPermissions({
        value: args.input.grantedPermissions,
        requestedPermissionClasses: version.permission_classes,
      });
      await tx
        .insert(piExtensionAssignments)
        .values({
          tenant_id: tenantId,
          version_id: versionId,
          target_type: target.targetType,
          agent_profile_id: null,
          enabled: true,
          granted_permissions: grantedPermissions,
          assigned_by_user_id: actorId,
          updated_at: now,
        })
        .onConflictDoUpdate({
          target: [
            piExtensionAssignments.tenant_id,
            piExtensionAssignments.version_id,
          ],
          targetWhere: sql`${piExtensionAssignments.target_type} = 'default_agent'`,
          set: {
            enabled: true,
            granted_permissions: grantedPermissions,
            assigned_by_user_id: actorId,
            updated_at: now,
          },
        });
    }

    return loadPiExtensionGraphql({
      tenantId,
      versionId,
      client: tx,
    });
  });

  return extension;
}

async function disablePreviousAssignments(input: {
  tx: Pick<typeof db, "select" | "update">;
  tenantId: string;
  versionId: string;
  sourceId: string;
  now: Date;
}) {
  const previousVersionRows = await input.tx
    .select({ id: piExtensionVersions.id })
    .from(piExtensionVersions)
    .where(
      and(
        eq(piExtensionVersions.tenant_id, input.tenantId),
        eq(piExtensionVersions.source_id, input.sourceId),
        ne(piExtensionVersions.id, input.versionId),
      ),
    );
  const previousVersionIds = previousVersionRows.map((row) => row.id);
  if (previousVersionIds.length === 0) return;

  await input.tx
    .update(piExtensionAssignments)
    .set({ enabled: false, updated_at: input.now })
    .where(
      and(
        eq(piExtensionAssignments.tenant_id, input.tenantId),
        eq(piExtensionAssignments.target_type, "default_agent"),
        isNull(piExtensionAssignments.agent_profile_id),
        inArray(piExtensionAssignments.version_id, previousVersionIds),
      ),
    );
}
