/**
 * One-time Twenty plugin cutover (plan 2026-06-12-001 U10).
 *
 * Run ONCE per tenant (by the `cutoverTwentyPlugin` admin mutation) after
 * the `twenty` plugin install exists. It moves MCP ownership from the
 * legacy managed-application reconciler to the plugin engine:
 *
 *   1. ADOPT — when the legacy managed row (management_source
 *      'managed_application', managed_application_key 'twenty-crm') still
 *      exists and the plugin MCP handler has not created its own row, the
 *      legacy row is adopted in place: slug → `twenty--crm` (so the
 *      handler's idempotent (tenant, install, slug) lookup converges on
 *      it), management_source → 'plugin', plugin_install_id set, and the
 *      install's `crm` component handler_ref is pointed at the row
 *      (state 'provisioned'). URL, auth_config, and url_hash are
 *      untouched — the plugin row is wire-identical to the managed row.
 *   2. DEDUPE — when the plugin handler ALREADY provisioned its own row
 *      (same endpoint), the legacy row is redundant: its inventory
 *      (user tokens + secrets, context tools, agent/template/space
 *      assignments, the row itself) is removed; the plugin row stays
 *      canonical.
 *   3. In both cases the legacy row's per-server `user_mcp_tokens` are
 *      invalidated (token rows deleted, secrets deleted via Secrets
 *      Manager) so users re-activate at APP level through the plugin
 *      activation flow.
 *
 * Idempotent: a re-run after a completed cutover finds no legacy row and
 * reports a no-op. Mutating runs emit a `plugin.cutover` compliance event
 * transactionally with the row changes (control-evidence tier).
 */

import { GraphQLError } from "graphql";

export const TWENTY_PLUGIN_KEY = "twenty";
export const TWENTY_PLUGIN_MCP_COMPONENT_KEY = "crm";
export const TWENTY_PLUGIN_MCP_SLUG = `${TWENTY_PLUGIN_KEY}--${TWENTY_PLUGIN_MCP_COMPONENT_KEY}`;

export interface TwentyCutoverAuditInput {
  tenantId: string;
  actorId: string;
  actorType: "user" | "system";
  eventType: "plugin.cutover";
  source: "graphql";
  payload: Record<string, unknown>;
  resourceType: "plugin_install";
  resourceId: string;
  action: "cutover";
  outcome: "success";
}

export interface TwentyCutoverResult {
  /** True when this run changed ownership (adopt or legacy-row removal). */
  adopted: boolean;
  /** The canonical plugin-owned Twenty MCP row after the run, if any. */
  mcpServerId: string | null;
  /** Per-server user_mcp_tokens invalidated (rows deleted) by this run. */
  invalidatedUserTokenCount: number;
  message: string;
}

interface ServerRowSnapshot {
  id: string;
  url: string;
}

export interface TwentyCutoverDeps {
  getTwentyInstall(tenantId: string): Promise<{ id: string } | null>;
  /** The legacy managed-application row, if it still exists. */
  getLegacyManagedRow(tenantId: string): Promise<ServerRowSnapshot | null>;
  /** The plugin-handler-created row for the install, if any. */
  getPluginRow(
    tenantId: string,
    installId: string,
  ): Promise<ServerRowSnapshot | null>;
  /** Delete the row's user tokens (+ their secrets); returns the count. */
  invalidateUserTokens(serverId: string): Promise<number>;
  /**
   * Adopt the legacy row in place (slug/management_source/plugin_install_id)
   * and point the install's mcp component handler_ref at it — one
   * transaction with the audit event.
   */
  adoptLegacyRow(args: {
    tenantId: string;
    installId: string;
    serverId: string;
    serverUrl: string;
    audit: TwentyCutoverAuditInput;
  }): Promise<void>;
  /**
   * Remove the redundant legacy row + its full inventory (context tools,
   * agent/template/space assignments, the row) — one transaction with the
   * audit event. Tokens are already gone via invalidateUserTokens.
   */
  removeLegacyRow(args: {
    tenantId: string;
    serverId: string;
    audit: TwentyCutoverAuditInput;
  }): Promise<void>;
}

function cutoverAudit(args: {
  tenantId: string;
  actorId: string;
  actorType: "user" | "system";
  installId: string;
  mcpServerId: string;
  mode: "adopted" | "legacy_row_removed";
  invalidatedUserTokenCount: number;
}): TwentyCutoverAuditInput {
  return {
    tenantId: args.tenantId,
    actorId: args.actorId,
    actorType: args.actorType,
    eventType: "plugin.cutover",
    source: "graphql",
    payload: {
      pluginInstallId: args.installId,
      pluginKey: TWENTY_PLUGIN_KEY,
      mcpServerId: args.mcpServerId,
      mode: args.mode,
      invalidatedUserTokenCount: args.invalidatedUserTokenCount,
    },
    resourceType: "plugin_install",
    resourceId: args.installId,
    action: "cutover",
    outcome: "success",
  };
}

export async function cutoverTwentyPluginForTenant(
  args: {
    tenantId: string;
    actorId: string;
    actorType: "user" | "system";
  },
  deps: TwentyCutoverDeps,
): Promise<TwentyCutoverResult> {
  const install = await deps.getTwentyInstall(args.tenantId);
  if (!install) {
    throw new GraphQLError(
      "Install the twenty plugin before running the cutover",
      { extensions: { code: "FAILED_PRECONDITION" } },
    );
  }

  const legacy = await deps.getLegacyManagedRow(args.tenantId);
  const pluginRow = await deps.getPluginRow(args.tenantId, install.id);

  if (!legacy) {
    return {
      adopted: false,
      mcpServerId: pluginRow?.id ?? null,
      invalidatedUserTokenCount: 0,
      message: pluginRow
        ? "Twenty MCP row is already plugin-owned; nothing to adopt (idempotent re-run)."
        : "No managed Twenty MCP row exists for this tenant; nothing to adopt.",
    };
  }

  const invalidatedUserTokenCount = await deps.invalidateUserTokens(legacy.id);

  if (pluginRow) {
    // The plugin handler already provisioned its own row — the legacy row
    // is a redundant same-endpoint duplicate. Remove it; the plugin row
    // stays canonical.
    await deps.removeLegacyRow({
      tenantId: args.tenantId,
      serverId: legacy.id,
      audit: cutoverAudit({
        tenantId: args.tenantId,
        actorId: args.actorId,
        actorType: args.actorType,
        installId: install.id,
        mcpServerId: pluginRow.id,
        mode: "legacy_row_removed",
        invalidatedUserTokenCount,
      }),
    });
    return {
      adopted: true,
      mcpServerId: pluginRow.id,
      invalidatedUserTokenCount,
      message: `Removed the redundant legacy Twenty MCP row (the plugin row is canonical) and invalidated ${invalidatedUserTokenCount} per-server user token(s); users re-activate at app level.`,
    };
  }

  await deps.adoptLegacyRow({
    tenantId: args.tenantId,
    installId: install.id,
    serverId: legacy.id,
    serverUrl: legacy.url,
    audit: cutoverAudit({
      tenantId: args.tenantId,
      actorId: args.actorId,
      actorType: args.actorType,
      installId: install.id,
      mcpServerId: legacy.id,
      mode: "adopted",
      invalidatedUserTokenCount,
    }),
  });

  return {
    adopted: true,
    mcpServerId: legacy.id,
    invalidatedUserTokenCount,
    message: `Adopted the managed Twenty MCP row to plugin ownership and invalidated ${invalidatedUserTokenCount} per-server user token(s); users re-activate at app level.`,
  };
}
