/**
 * Shared auth + payload shaping for the plugin resolvers
 * (plan 2026-06-12-001 U5).
 *
 * Auth follows `deployments/shared.ts`: `ctx.auth.tenantId` is null for
 * Google-federated users, so every resolver pins the tenant via
 * `resolveCallerTenantId(ctx)`; admin mutations additionally pass
 * `requireTenantAdmin`.
 *
 * Gating split (mirrors the U8 UI decision): catalog browse and
 * `myPluginActivations` are member-level (non-operators reach the plugin
 * detail page to Connect); installs queries and all install mutations are
 * tenant-admin.
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { snakeToCamel } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import type { PluginEngineActor } from "../../../lib/plugins/engine.js";
import type {
  PluginComponentRow,
  PluginInstallRow,
} from "../../../lib/plugins/store.js";

export async function requirePluginTenantAdmin(
  ctx: GraphQLContext,
): Promise<{ tenantId: string; callerUserId: string | null }> {
  const tenantId = await resolveCallerTenantId(ctx);
  if (!tenantId) {
    throw new GraphQLError("Tenant context required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  await requireTenantAdmin(ctx, tenantId);
  return { tenantId, callerUserId: await resolveCallerUserId(ctx) };
}

export async function requirePluginTenantMember(
  ctx: GraphQLContext,
): Promise<{ tenantId: string; callerUserId: string | null }> {
  const tenantId = await resolveCallerTenantId(ctx);
  if (!tenantId) {
    throw new GraphQLError("Tenant context required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  return { tenantId, callerUserId: await resolveCallerUserId(ctx) };
}

export function pluginActorFor(callerUserId: string | null): PluginEngineActor {
  return callerUserId
    ? { actorId: callerUserId, actorType: "user" }
    : { actorId: "system", actorType: "system" };
}

export function toPluginInstallPayload(
  install: PluginInstallRow,
  components: PluginComponentRow[],
  activatedUserCount: number,
): Record<string, unknown> {
  return {
    ...snakeToCamel(install as unknown as Record<string, unknown>),
    components: components.map((component) =>
      snakeToCamel(component as unknown as Record<string, unknown>),
    ),
    activatedUserCount,
  };
}
