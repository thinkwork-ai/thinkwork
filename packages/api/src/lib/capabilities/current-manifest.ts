/**
 * Current-manifest resolution for thread-less dispatchers (THINK-179).
 *
 * A `capability_folder_dispatch` agent's attached connection set comes
 * exclusively from the compiled capabilities manifest, and buildMcpConfigs
 * refuses folder-unaware callers for flag-on agents (THINK-173 R20).
 * Callers that dispatch OUTSIDE a thread render — the eval worker, the
 * mcp-proxy — resolve the agent's CURRENT manifest through a read-only
 * tuple render (`persist: false`, the same resolution workspacePreview
 * uses), rendered in the agent's default Space.
 *
 * Contract:
 *   - flag-off agent → `undefined` (caller omits folderCapabilities and
 *     the legacy/workspace-file path applies unchanged)
 *   - flag-on agent  → `{ manifest }` (possibly `manifest: null` when the
 *     render compiled no manifest — still a folder-AWARE value; R20 must
 *     not silently regress to defer/legacy)
 *   - flag-on agent with no default Space → throws (loud, matching the
 *     R20 doctrine: never a silent legacy fallback)
 */

import { db, eq } from "../../graphql/utils.js";
import { agents } from "@thinkwork/database-pg/schema";
import type { CapabilitiesManifest } from "./manifest-compile.js";

/**
 * The Space a thread-less dispatch renders in
 * (`agents.runtime_config.defaultSpaceId`) — mirrors
 * workspacePreview.query.ts's selection resolution.
 */
export function defaultSpaceIdFromRuntimeConfig(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const defaultSpaceId = (value as { defaultSpaceId?: unknown }).defaultSpaceId;
  return typeof defaultSpaceId === "string" && defaultSpaceId.trim()
    ? defaultSpaceId
    : null;
}

export interface ResolveCurrentManifestDeps {
  loadAgent?: (agentId: string) => Promise<{
    capability_folder_dispatch: boolean | null;
    runtime_config: unknown;
  } | null>;
  renderTuple?: (input: {
    tenantId: string;
    agentId: string;
    spaceId: string;
    userId: string | null;
  }) => Promise<{ capabilities?: { manifest: CapabilitiesManifest } | null }>;
}

/**
 * Resolve a folder-dispatch agent's current capabilities manifest, or
 * `undefined` for flag-off agents. Spread the result straight into
 * `resolveAgentRuntimeConfig` opts:
 *
 *   const manifest = await resolveCurrentCapabilitiesManifest({...});
 *   resolveAgentRuntimeConfig({ ..., ...(manifest !== undefined
 *     ? { capabilitiesManifest: manifest } : {}) });
 */
export async function resolveCurrentCapabilitiesManifest(input: {
  tenantId: string;
  agentId: string;
  /** Render perspective; null renders the agent baseline (no user overlay). */
  userId?: string | null;
  logPrefix: string;
  deps?: ResolveCurrentManifestDeps;
}): Promise<CapabilitiesManifest | null | undefined> {
  const loadAgent =
    input.deps?.loadAgent ??
    (async (agentId: string) => {
      const rows = await db
        .select({
          capability_folder_dispatch: agents.capability_folder_dispatch,
          runtime_config: agents.runtime_config,
        })
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);
      return rows[0] ?? null;
    });

  const agent = await loadAgent(input.agentId);
  if (!agent || agent.capability_folder_dispatch !== true) return undefined;

  const spaceId = defaultSpaceIdFromRuntimeConfig(agent.runtime_config);
  if (!spaceId) {
    throw new Error(
      `${input.logPrefix} folder-dispatch agent ${input.agentId} has no default Space configured — cannot render a capabilities manifest (R20: refusing silent legacy fallback)`,
    );
  }

  const renderTuple =
    input.deps?.renderTuple ??
    (async (tupleInput: {
      tenantId: string;
      agentId: string;
      spaceId: string;
      userId: string | null;
    }) => {
      const { renderWorkspaceTuple } = await import(
        "../workspace-renderer/compose-tuple.js"
      );
      return renderWorkspaceTuple(tupleInput, { persist: false });
    });

  const rendered = await renderTuple({
    tenantId: input.tenantId,
    agentId: input.agentId,
    spaceId,
    userId: input.userId ?? null,
  });
  return rendered.capabilities?.manifest ?? null;
}
