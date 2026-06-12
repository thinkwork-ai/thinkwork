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
  pluginActorFor,
  requirePluginTenantAdmin,
  requirePluginTenantMember,
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
      idempotencyKey: args.input.idempotencyKey,
      actor: pluginActorFor(callerUserId),
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
