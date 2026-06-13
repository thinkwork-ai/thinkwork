/**
 * Plugin mutations (plan 2026-06-12-001 U5 + U6).
 *
 * install/upgrade/uninstall/retry are tenant-admin gated and run the
 * engine synchronously inside the GraphQL request (errors surface to the
 * caller — never fire-and-forget). Infrastructure components are the
 * async exception: their deployment jobs complete behind the EXISTING
 * deployment approve/reject mutations, and install/uninstall completion
 * is learned by read-time reconciliation on the status queries (U11).
 *
 * activatePlugin / deactivatePlugin (U6) are MEMBER-level: any
 * authenticated tenant member activates for THEMSELF. The acting user is
 * the canonical caller resolved from the auth context — never an input
 * field — and the install must belong to the caller's tenant
 * (startActivation/deactivateActivation pin by resolveCallerTenantId's
 * tenant).
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { snakeToCamel } from "../../utils.js";
import {
  createDefaultPluginActivationDeps,
  deactivateActivation,
  startActivation,
} from "../../../lib/plugins/activation.js";
import { normalizeMcpOAuthReturnTo } from "../../../lib/mcp-oauth-client.js";
import {
  createDefaultPluginEngineDeps,
  installPlugin as engineInstallPlugin,
  retryPluginComponent as engineRetryPluginComponent,
  uninstallPlugin as engineUninstallPlugin,
  upgradePlugin as engineUpgradePlugin,
} from "../../../lib/plugins/engine.js";
import type { PluginEngineDeps } from "../../../lib/plugins/engine.js";
import type { PluginInstallRow } from "../../../lib/plugins/store.js";
import {
  createDefaultPremiumEntitlementDeps,
  issuePremiumInstallKey,
  redeemPremiumInstallKey,
  revokePremiumInstallKey,
} from "../../../lib/plugins/premium-entitlements.js";
import { cutoverTwentyPluginForTenant } from "../../../lib/plugins/twenty-cutover.js";
import {
  pluginActorFor,
  pluginRequestMetadata,
  requirePluginTenantAdmin,
  requirePluginTenantMember,
  requireThinkWorkPlatformOperator,
  toPluginInstallPayload,
} from "./shared.js";

async function installResultPayload(
  install: PluginInstallRow,
  deps: PluginEngineDeps,
): Promise<Record<string, unknown>> {
  // After a completed uninstall the row is gone: components and the
  // activation count both read back empty, which is the correct final
  // snapshot shape.
  const components = await deps.store.listComponents(install.id);
  const activatedUserCount = await deps.store.countActiveActivations(
    install.id,
  );
  return toPluginInstallPayload(install, components, activatedUserCount);
}

export async function installPlugin(
  _parent: unknown,
  args: {
    input: {
      pluginKey: string;
      version?: string | null;
      installKey?: string | null;
      idempotencyKey: string;
    };
  },
  ctx: GraphQLContext,
) {
  const { tenantId, callerUserId } = await requirePluginTenantAdmin(ctx);
  const deps = createDefaultPluginEngineDeps();
  const install = await engineInstallPlugin(
    {
      tenantId,
      pluginKey: args.input.pluginKey,
      version: args.input.version ?? null,
      installKey: args.input.installKey ?? null,
      idempotencyKey: args.input.idempotencyKey,
      actor: pluginActorFor(callerUserId),
      request: pluginRequestMetadata(ctx),
    },
    deps,
  );
  return installResultPayload(install, deps);
}

export async function upgradePlugin(
  _parent: unknown,
  args: {
    input: { installId: string; version: string; idempotencyKey: string };
  },
  ctx: GraphQLContext,
) {
  const { tenantId, callerUserId } = await requirePluginTenantAdmin(ctx);
  const deps = createDefaultPluginEngineDeps();
  const install = await engineUpgradePlugin(
    {
      tenantId,
      installId: args.input.installId,
      toVersion: args.input.version,
      actor: pluginActorFor(callerUserId),
      request: pluginRequestMetadata(ctx),
    },
    deps,
  );
  return installResultPayload(install, deps);
}

export async function uninstallPlugin(
  _parent: unknown,
  args: {
    input: { installId: string; destructiveConfirmation?: string | null };
  },
  ctx: GraphQLContext,
) {
  const { tenantId, callerUserId } = await requirePluginTenantAdmin(ctx);
  const deps = createDefaultPluginEngineDeps();
  const install = await engineUninstallPlugin(
    {
      tenantId,
      installId: args.input.installId,
      destructiveConfirmation: args.input.destructiveConfirmation,
      actor: pluginActorFor(callerUserId),
    },
    deps,
  );
  return installResultPayload(install, deps);
}

export async function retryPluginComponent(
  _parent: unknown,
  args: { input: { installId: string; componentKey: string } },
  ctx: GraphQLContext,
) {
  const { tenantId, callerUserId } = await requirePluginTenantAdmin(ctx);
  const deps = createDefaultPluginEngineDeps();
  const install = await engineRetryPluginComponent(
    {
      tenantId,
      installId: args.input.installId,
      componentKey: args.input.componentKey,
      actor: pluginActorFor(callerUserId),
    },
    deps,
  );
  return installResultPayload(install, deps);
}

/**
 * One-time U10 Twenty cutover (tenant admin, RequestResponse — runs
 * synchronously inside the GraphQL request and surfaces errors to the
 * caller). The validation session runs this once per tenant after the
 * twenty plugin install exists; re-runs are idempotent no-ops.
 */
export async function cutoverTwentyPlugin(
  _parent: unknown,
  _args: Record<string, never>,
  ctx: GraphQLContext,
) {
  const { tenantId, callerUserId } = await requirePluginTenantAdmin(ctx);
  const actor = pluginActorFor(callerUserId);
  return cutoverTwentyPluginForTenant({
    tenantId,
    actorId: actor.actorId,
    actorType: actor.actorType,
  });
}

async function requireActivationCaller(
  ctx: GraphQLContext,
): Promise<{ tenantId: string; callerUserId: string }> {
  const { tenantId, callerUserId } = await requirePluginTenantMember(ctx);
  if (!callerUserId) {
    throw new GraphQLError("User context required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  return { tenantId, callerUserId };
}

export async function activatePlugin(
  _parent: unknown,
  args: { input: { installId: string; returnTo?: string | null } },
  ctx: GraphQLContext,
) {
  const { tenantId, callerUserId } = await requireActivationCaller(ctx);
  const rawReturnTo = args.input.returnTo ?? null;
  const returnTo = normalizeMcpOAuthReturnTo(rawReturnTo ?? undefined);
  if (rawReturnTo && !returnTo) {
    throw new GraphQLError("Invalid plugin OAuth return URL", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const deps = createDefaultPluginActivationDeps();
  const { authorizeUrl } = await startActivation(
    {
      userId: callerUserId,
      tenantId,
      pluginInstallId: args.input.installId,
      returnTo,
    },
    deps,
  );
  return { authorizeUrl };
}

export async function deactivatePlugin(
  _parent: unknown,
  args: { input: { installId: string } },
  ctx: GraphQLContext,
) {
  const { tenantId, callerUserId } = await requireActivationCaller(ctx);
  const deps = createDefaultPluginActivationDeps();
  const activation = await deactivateActivation(
    {
      userId: callerUserId,
      tenantId,
      pluginInstallId: args.input.installId,
    },
    deps,
  );
  const install = await deps.store.getInstallById(
    tenantId,
    args.input.installId,
  );
  return {
    ...snakeToCamel(activation as unknown as Record<string, unknown>),
    pluginKey: install?.plugin_key ?? "",
    grantedScopes: activation.granted_scopes ?? [],
  };
}

export async function issuePremiumPluginInstallKey(
  _parent: unknown,
  args: {
    input: {
      pluginKey: string;
      tenantId: string;
      expiresAt?: string | null;
    };
  },
  ctx: GraphQLContext,
) {
  const { callerUserId } = await requireThinkWorkPlatformOperator(ctx);
  const deps = createDefaultPremiumEntitlementDeps();
  const result = await issuePremiumInstallKey(
    {
      pluginKey: args.input.pluginKey,
      tenantId: args.input.tenantId,
      expiresAt: args.input.expiresAt ? new Date(args.input.expiresAt) : null,
      actor: pluginActorFor(callerUserId),
      request: pluginRequestMetadata(ctx),
    },
    deps,
  );
  return {
    keyId: result.key.id,
    pluginKey: result.key.plugin_key,
    entitlementProductKey: result.key.entitlement_product_key,
    tenantId: result.key.tenant_id,
    installKey: result.rawKey,
    expiresAt: result.key.expires_at,
    issuedAt: result.key.issued_at,
  };
}

export async function redeemPremiumPluginInstallKey(
  _parent: unknown,
  args: { input: { pluginKey: string; installKey: string } },
  ctx: GraphQLContext,
) {
  const { tenantId, callerUserId } = await requirePluginTenantAdmin(ctx);
  const deps = createDefaultPremiumEntitlementDeps();
  const result = await redeemPremiumInstallKey(
    {
      tenantId,
      pluginKey: args.input.pluginKey,
      rawKey: args.input.installKey,
      actor: pluginActorFor(callerUserId),
      request: pluginRequestMetadata(ctx),
    },
    deps,
  );
  return {
    entitlement: snakeToCamel(
      result.entitlement as unknown as Record<string, unknown>,
    ),
    source: result.source,
  };
}

export async function revokePremiumPluginInstallKey(
  _parent: unknown,
  args: { input: { keyId: string; tenantId: string } },
  ctx: GraphQLContext,
) {
  const { callerUserId } = await requireThinkWorkPlatformOperator(ctx);
  const deps = createDefaultPremiumEntitlementDeps();
  const result = await revokePremiumInstallKey(
    {
      keyId: args.input.keyId,
      tenantId: args.input.tenantId,
      actor: pluginActorFor(callerUserId),
      request: pluginRequestMetadata(ctx),
    },
    deps,
  );
  return {
    keyId: result.key.id,
    pluginKey: result.key.plugin_key,
    status: result.key.status,
    revokedAt: result.key.revoked_at,
  };
}
