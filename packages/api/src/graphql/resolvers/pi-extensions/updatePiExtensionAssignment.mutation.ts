import type { GraphQLContext } from "../../context.js";
import {
  agentProfiles,
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
      const agentProfileId = target.agentProfileId;
      if (!agentProfileId)
        throw badInput("Agent Profile assignment requires profile id");
      const [profile] = await tx
        .select()
        .from(agentProfiles)
        .where(
          and(
            eq(agentProfiles.tenant_id, tenantId),
            eq(agentProfiles.id, agentProfileId),
          ),
        );
      if (!profile) throw badInput("Agent Profile does not belong to tenant");
      if (profile.source_space_id != null) {
        throw badInput("Space-local Agent Profiles cannot receive extensions");
      }
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
            target.targetType === "agent_profile"
              ? eq(
                  piExtensionAssignments.agent_profile_id,
                  target.agentProfileId!,
                )
              : isNull(piExtensionAssignments.agent_profile_id),
          ),
        );
    } else {
      await disablePreviousAssignments({
        tx,
        tenantId,
        versionId,
        sourceId: version.source_id,
        targetType: target.targetType,
        agentProfileId: target.agentProfileId,
        now,
      });
      const grantedPermissions = normalizeGrantedPermissions({
        value: args.input.grantedPermissions,
        requestedPermissionClasses: version.permission_classes,
      });
      if (target.targetType === "default_agent") {
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
      } else {
        await tx
          .insert(piExtensionAssignments)
          .values({
            tenant_id: tenantId,
            version_id: versionId,
            target_type: target.targetType,
            agent_profile_id: target.agentProfileId,
            enabled: true,
            granted_permissions: grantedPermissions,
            assigned_by_user_id: actorId,
            updated_at: now,
          })
          .onConflictDoUpdate({
            target: [
              piExtensionAssignments.tenant_id,
              piExtensionAssignments.agent_profile_id,
              piExtensionAssignments.version_id,
            ],
            targetWhere: sql`${piExtensionAssignments.target_type} = 'agent_profile'`,
            set: {
              enabled: true,
              granted_permissions: grantedPermissions,
              assigned_by_user_id: actorId,
              updated_at: now,
            },
          });
      }
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
  targetType: "default_agent" | "agent_profile";
  agentProfileId: string | null;
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

  const targetCondition =
    input.targetType === "agent_profile"
      ? eq(piExtensionAssignments.agent_profile_id, input.agentProfileId!)
      : isNull(piExtensionAssignments.agent_profile_id);

  await input.tx
    .update(piExtensionAssignments)
    .set({ enabled: false, updated_at: input.now })
    .where(
      and(
        eq(piExtensionAssignments.tenant_id, input.tenantId),
        eq(piExtensionAssignments.target_type, input.targetType),
        targetCondition,
        inArray(piExtensionAssignments.version_id, previousVersionIds),
      ),
    );
}
