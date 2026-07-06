/**
 * Discovered-tool cache for tenant_mcp_servers (THINK-179).
 *
 * `tenant_mcp_servers.tools` is the registry's cached tool inventory. It
 * feeds `availableTools` on dispatch configs, which downstream consumers
 * treat as the server's classifiable tool surface — most critically eval
 * replay (`selectReplayMcpTools`), which DROPS any server with an empty
 * cache because it cannot classify read vs write tools it has never seen.
 *
 * Historically the only writer was the operator "Test Connection" flow,
 * which can authenticate tenant_api_key / service_credential servers but
 * not per-user OAuth ones — so OAuth/plugin servers (twenty--crm et al.)
 * sat at 0 cached tools forever. This module centralizes the cache write
 * so any code path that has just performed a SUCCESSFUL authenticated
 * `tools/list` can write back what it saw:
 *
 *   - skills.ts `mcpTestConnection` (operator-initiated, canonical)
 *   - mcp-proxy `tools/list` (lazy write-back: the proxy already resolved
 *     the caller's OAuth token and listed tools for the live request, so
 *     caching costs zero extra token operations)
 *
 * The write also upserts tenant_mcp_context_tools eligibility rows (the
 * Context Engine's per-tool read-only/search-safe declarations) so lazily
 * cached servers get the same treatment as Test Connection ones.
 */

import { eq, and, or, isNull } from "drizzle-orm";
import { db } from "./db.js";
import {
  tenantMcpServers,
  tenantMcpContextTools,
} from "@thinkwork/database-pg/schema";
import type { McpToolDefinition } from "./mcp-client-call.js";

// Table imports use the `/schema` subpath (matching skills.ts) so handler
// test suites that mock the package root without a `schema` export don't
// break at import time.
function tables() {
  return { tenantMcpServers, tenantMcpContextTools };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface CacheDiscoveredMcpToolsInput {
  tenantId: string;
  /** Registry row id when the caller has it (Test Connection path). */
  serverId?: string;
  /**
   * Dispatch-config identity when the caller only has a config (proxy
   * path): matches `slug`, falling back to `name` for slug-less rows —
   * the same identity `toMcpServerConfig` emits as `config.name`.
   */
  serverConfigName?: string;
  defs: McpToolDefinition[];
}

/**
 * Persist a successful discovery into the registry tool cache. Returns
 * true when a row was updated. Never throws — cache maintenance must not
 * fail the request that produced the discovery.
 */
export async function cacheDiscoveredMcpTools(
  input: CacheDiscoveredMcpToolsInput,
): Promise<boolean> {
  const { tenantId, serverId, serverConfigName, defs } = input;
  if (defs.length === 0) return false;

  try {
    const { tenantMcpServers } = tables();
    let resolvedServerId = serverId ?? null;
    if (!resolvedServerId && serverConfigName) {
      const [row] = await db
        .select({ id: tenantMcpServers.id })
        .from(tenantMcpServers)
        .where(
          and(
            eq(tenantMcpServers.tenant_id, tenantId),
            or(
              eq(tenantMcpServers.slug, serverConfigName),
              and(
                isNull(tenantMcpServers.slug),
                eq(tenantMcpServers.name, serverConfigName),
              ),
            ),
          ),
        )
        .limit(1);
      resolvedServerId = row?.id ?? null;
    }
    if (!resolvedServerId) return false;

    const tools = defs
      .filter((def) => typeof def.name === "string" && def.name.length > 0)
      .map((def) => ({
        name: def.name,
        ...(def.description !== undefined
          ? { description: def.description }
          : {}),
      }));
    if (tools.length === 0) return false;

    await db
      .update(tenantMcpServers)
      .set({ tools, updated_at: new Date() })
      .where(
        and(
          eq(tenantMcpServers.id, resolvedServerId),
          eq(tenantMcpServers.tenant_id, tenantId),
        ),
      );

    await upsertMcpContextToolEligibility(
      tenantId,
      resolvedServerId,
      defs.map(
        (def) =>
          ({ ...def }) as Record<string, unknown> & {
            name: string;
            description?: string;
          },
      ),
    );
    return true;
  } catch (err) {
    console.warn(
      "[mcp-tool-cache] cache write-back failed (request unaffected):",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Upsert per-tool Context Engine eligibility rows from discovered tool
 * definitions. Mirrors the declarations the server ships (readOnlyHint /
 * contextEngine.readOnly / searchSafe).
 */
export async function upsertMcpContextToolEligibility(
  tenantId: string,
  serverId: string,
  tools: Array<
    Record<string, unknown> & { name: string; description?: string }
  >,
): Promise<void> {
  const { tenantMcpContextTools } = tables();
  for (const tool of tools) {
    if (typeof tool.name !== "string" || tool.name.length === 0) continue;
    const context = isRecord(tool.contextEngine)
      ? tool.contextEngine
      : isRecord(tool.metadata) && isRecord(tool.metadata.contextEngine)
        ? tool.metadata.contextEngine
        : {};
    const annotations = isRecord(tool.annotations) ? tool.annotations : {};
    const declaredReadOnly =
      annotations.readOnlyHint === true || context.readOnly === true;
    const declaredSearchSafe = context.searchSafe === true;
    const displayName =
      typeof tool.title === "string"
        ? tool.title
        : typeof tool.description === "string"
          ? tool.description.slice(0, 80)
          : tool.name;

    await db
      .insert(tenantMcpContextTools)
      .values({
        tenant_id: tenantId,
        mcp_server_id: serverId,
        tool_name: tool.name,
        display_name: displayName,
        declared_read_only: declaredReadOnly,
        declared_search_safe: declaredSearchSafe,
        metadata: tool,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          tenantMcpContextTools.tenant_id,
          tenantMcpContextTools.mcp_server_id,
          tenantMcpContextTools.tool_name,
        ],
        set: {
          display_name: displayName,
          declared_read_only: declaredReadOnly,
          declared_search_safe: declaredSearchSafe,
          metadata: tool,
          updated_at: new Date(),
        },
      });
  }
}
