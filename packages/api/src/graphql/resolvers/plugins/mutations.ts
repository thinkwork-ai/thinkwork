/**
 * Plugin mutations (plan 2026-06-12-001 U5).
 *
 * install/upgrade/uninstall/retry are tenant-admin gated and run the
 * engine synchronously inside the GraphQL request (v1 plugins have no
 * infrastructure components, so teardown/provisioning completes in-line;
 * errors surface to the caller — never fire-and-forget).
 *
 * activatePlugin / deactivatePlugin are U6 (app-level OAuth activation):
 * stubbed with a structured NOT_IMPLEMENTED error so the SDL surface is
 * complete without faking an OAuth flow.
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
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

export async function activatePlugin(): Promise<never> {
  throw new GraphQLError(
    "Plugin activation is not implemented yet (app-level OAuth activation ships in plan U6)",
    { extensions: { code: "NOT_IMPLEMENTED" } },
  );
}

export async function deactivatePlugin(): Promise<never> {
  throw new GraphQLError(
    "Plugin deactivation is not implemented yet (app-level OAuth activation ships in plan U6)",
    { extensions: { code: "NOT_IMPLEMENTED" } },
  );
}
