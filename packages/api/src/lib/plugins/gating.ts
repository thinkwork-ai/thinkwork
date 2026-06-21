/**
 * Shared plugin activation gate (plan 2026-06-12-001 U7).
 *
 * ONE module computes, per requester, which plugin installs are active
 * and which plugin-owned skill folders must therefore be excluded from
 * the rendered workspace. It is consumed by:
 *
 *   - the workspace renderer (`compose-tuple.ts`) — excludes plugin
 *     skill folders (and their CONTEXT.md routing entries) from the
 *     rendered tuple for requesters without an active activation;
 *   - BOTH dispatch payload builders (`chat-agent-invoke.ts` and
 *     `wakeup-processor.ts`) — via `applyWorkspaceMcpPolicyFilter`, the
 *     deduplicated TOOLS.md policy chokepoint that previously existed as
 *     two copy-pasted filters (the seam behind three prior parity bugs).
 *
 * MCP-side plugin gating itself lives in `buildMcpConfigs` (U6): plugin
 * rows resolve by `requesterUserId` against activation token records and
 * fail closed on a null requester. This module owns the SKILLS/workspace
 * half and keeps both halves keyed on the SAME requester identity:
 *
 *   - chat turns: `currentUserId` (message sender → thread creator →
 *     computer-agent human pair) feeds buildMcpConfigs AND the workspace
 *     render (`renderWorkspaceTupleForInvoke({ userId: currentUserId })`).
 *   - wakeup turns: `invokerUserId` (requested_by_actor_type='user' only)
 *     feeds buildMcpConfigs; the render receives `costOwnerUserId`, which
 *     is `invokerUserId` verified to exist in the tenant. The two only
 *     diverge when the invoker is NOT a tenant user — and in that case
 *     BOTH halves fail closed (no activation rows can exist for a
 *     non-tenant user), so the gates cannot disagree in the open
 *     direction.
 *
 * Fail-closed contract: no resolvable requester → empty allowed set →
 * every plugin install's skill folders are excluded. A gate-resolution
 * error (e.g. DB unavailable inside the renderer Lambda) degrades to
 * pattern-based exclusion of legacy plugin-namespaced skill folders — never
 * open for the historical shape; exact recorded folders and known install
 * plugin-key prefixes cover Agent Skills compliant plugin folders when the
 * store is reachable.
 *
 * AGENTS.md routing finding (documented per U7): plugin skill routing
 * entries are NOT generated at render time. `installCatalogSkill` appends
 * the WIRING.md snippet ("… read skills/<slug>/SKILL.md and follow it")
 * to the agent workspace's CONTEXT.md at install time, and the runtime
 * activates skills by walking materialized `skills/<slug>/SKILL.md`
 * files (`derive-agent-skills.ts` syncs a derived DB table from the same
 * folder presence). The render-time AGENTS.md composition only rewrites
 * the Active Space section and mentionable-workspace tables — it carries
 * no per-skill rows. The gate therefore filters (a) the skill FOLDERS
 * out of the hydrate manifest (which removes runtime activation), and
 * (b) the per-skill routing LINES out of CONTEXT.md via a generated,
 * per-thread-render replacement file.
 */

import type {
  PluginComponentRow,
  PluginEngineStore,
  PluginInstallRow,
} from "./store.js";

// ---------------------------------------------------------------------------
// Gate shape
// ---------------------------------------------------------------------------

/** Store surface the gate needs — satisfied by PluginEngineStore. */
export type PluginGateStore = Pick<
  PluginEngineStore,
  "listInstalls" | "listComponents" | "listActivationsForUser"
>;

export interface PluginActivationGate {
  /** Tenant has at least one plugin install row. */
  hasPluginInstalls: boolean;
  /** Install ids the requester holds an ACTIVE activation for. */
  allowedInstallIds: Set<string>;
  /** Install ids gated off for this requester. */
  blockedInstallIds: Set<string>;
  /**
   * Workspace-relative skill folder prefixes to exclude. Entries are
   * either exact folders recorded on the skills component handler_ref
   * (`skills/lastmile--crm-basics/`) or, as the fallback for installs
   * whose handler_ref never recorded folders, conservative plugin-key
   * prefixes (`skills/lastmile--` for legacy ThinkWork namespaced skills
   * and `skills/lastmile-` for Agent Skills spec-compliant plugin skills).
   */
  blockedSkillFolderPrefixes: string[];
  /**
   * Degraded fail-closed mode: gate resolution errored, so every legacy
   * plugin-namespaced skill folder is excluded by pattern.
   */
  blockAllNamespacedPluginFolders: boolean;
}

export const EMPTY_PLUGIN_GATE: PluginActivationGate = Object.freeze({
  hasPluginInstalls: false,
  allowedInstallIds: new Set<string>(),
  blockedInstallIds: new Set<string>(),
  blockedSkillFolderPrefixes: [],
  blockAllNamespacedPluginFolders: false,
});

export const FAIL_CLOSED_PLUGIN_GATE: PluginActivationGate = Object.freeze({
  hasPluginInstalls: true,
  allowedInstallIds: new Set<string>(),
  blockedInstallIds: new Set<string>(),
  blockedSkillFolderPrefixes: [],
  blockAllNamespacedPluginFolders: true,
});

const NAMESPACED_PLUGIN_SKILL_PATH_RE = /^skills\/[a-z0-9][a-z0-9-]*--[^/]+\//;

/** Pattern check: does this workspace-relative path sit under a legacy plugin-namespaced skill folder? */
export function isNamespacedPluginSkillPath(relPath: string): boolean {
  return NAMESPACED_PLUGIN_SKILL_PATH_RE.test(relPath);
}

const EXACT_SKILL_FOLDER_RE = /^skills\/[a-z0-9][a-z0-9-]*\/$/;

// ---------------------------------------------------------------------------
// resolvePluginGate
// ---------------------------------------------------------------------------

export interface ResolvePluginGateArgs {
  tenantId: string;
  /** Null/undefined → fail closed: nothing plugin-gated is allowed. */
  requesterUserId: string | null | undefined;
}

export interface ResolvePluginGateDeps {
  store?: PluginGateStore;
}

let defaultStorePromise: Promise<PluginGateStore> | null = null;
/** Lazy: the Drizzle store (and its DB import graph) loads only on first use. */
function getDefaultStore(): Promise<PluginGateStore> {
  if (!defaultStorePromise) {
    defaultStorePromise = import("./store.js").then((module) =>
      module.createDrizzlePluginEngineStore(),
    );
  }
  return defaultStorePromise;
}

function skillFolderPrefixesForInstall(
  install: PluginInstallRow,
  components: PluginComponentRow[],
): string[] {
  const prefixes = new Set<string>();
  for (const component of components) {
    if (component.component_type !== "skills") continue;
    const handlerRef = (component.handler_ref ?? {}) as Record<string, unknown>;
    const folders = Array.isArray(handlerRef.workspaceFolders)
      ? handlerRef.workspaceFolders
      : [];
    for (const folder of folders) {
      if (typeof folder === "string" && EXACT_SKILL_FOLDER_RE.test(folder)) {
        prefixes.add(folder);
      }
    }
  }
  // Prefix-pattern belt: covers skills components whose handler_ref was
  // never (or only partially) recorded — pending/partial provisions, crash
  // windows. Legacy ThinkWork plugin skills used `skills/<pluginKey>--...`;
  // Agent Skills spec-compliant plugin skills use `skills/<pluginKey>-...`.
  // This fallback is intentionally conservative and only used when exact
  // provisioned folders are unavailable.
  prefixes.add(`skills/${install.plugin_key}--`);
  prefixes.add(`skills/${install.plugin_key}-`);
  return [...prefixes];
}

/**
 * Compute the requester's plugin activation gate for a tenant.
 *
 * Never throws and NEVER fails open: a resolution error returns the
 * degraded pattern-exclusion gate.
 */
export async function resolvePluginGate(
  args: ResolvePluginGateArgs,
  deps: ResolvePluginGateDeps = {},
): Promise<PluginActivationGate> {
  try {
    const store = deps.store ?? (await getDefaultStore());
    const installs = await store.listInstalls(args.tenantId);
    if (installs.length === 0) {
      return EMPTY_PLUGIN_GATE;
    }

    const allowedInstallIds = new Set<string>();
    if (args.requesterUserId) {
      const activations = await store.listActivationsForUser(
        args.requesterUserId,
        installs.map((install) => install.id),
      );
      for (const activation of activations) {
        if (activation.status === "active") {
          allowedInstallIds.add(activation.plugin_install_id);
        }
      }
    }

    const blockedInstallIds = new Set<string>();
    const blockedSkillFolderPrefixes: string[] = [];
    for (const install of installs) {
      if (allowedInstallIds.has(install.id)) continue;
      blockedInstallIds.add(install.id);
      const components = await store.listComponents(install.id);
      for (const prefix of skillFolderPrefixesForInstall(install, components)) {
        if (!blockedSkillFolderPrefixes.includes(prefix)) {
          blockedSkillFolderPrefixes.push(prefix);
        }
      }
    }

    return {
      hasPluginInstalls: true,
      allowedInstallIds,
      blockedInstallIds,
      blockedSkillFolderPrefixes,
      blockAllNamespacedPluginFolders: false,
    };
  } catch (error) {
    console.warn(
      `[plugin-gate] gate resolution failed for tenant ${args.tenantId}; failing closed for legacy plugin-namespaced skill folders:`,
      error,
    );
    return FAIL_CLOSED_PLUGIN_GATE;
  }
}

// ---------------------------------------------------------------------------
// Workspace-side helpers (consumed by compose-tuple)
// ---------------------------------------------------------------------------

export function pluginGateHasExclusions(gate: PluginActivationGate): boolean {
  return (
    gate.blockAllNamespacedPluginFolders ||
    gate.blockedSkillFolderPrefixes.length > 0
  );
}

/**
 * Should this workspace-relative source path be excluded from the
 * rendered tuple for the gated requester? `relPath` is the runtime
 * source path (legacy `source/` / `workspace/` wrappers already
 * stripped), e.g. `skills/lastmile--crm-basics/SKILL.md`.
 */
export function pluginGateExcludesWorkspacePath(
  gate: PluginActivationGate,
  relPath: string,
): boolean {
  if (!relPath.startsWith("skills/")) return false;
  if (
    gate.blockAllNamespacedPluginFolders &&
    isNamespacedPluginSkillPath(relPath)
  ) {
    return true;
  }
  return gate.blockedSkillFolderPrefixes.some((prefix) =>
    relPath.startsWith(prefix),
  );
}

/** Matches `skills/<slug>/` references inside routing/markdown lines. */
const SKILL_FOLDER_REFERENCE_RE = /skills\/([a-z0-9][a-z0-9-]*)\//g;

/**
 * Filter per-skill routing entries out of CONTEXT.md for a gated
 * requester. Routing entries are the WIRING.md snippet lines appended by
 * `installCatalogSkill` (each references `skills/<slug>/…`); any line
 * referencing a gate-excluded skill folder is dropped. Lines referencing
 * non-plugin skills (or allowed plugin skills) pass through verbatim.
 */
export function filterContextRoutingEntries(
  content: string,
  gate: PluginActivationGate,
): { content: string; changed: boolean } {
  if (!pluginGateHasExclusions(gate)) return { content, changed: false };
  const lines = content.split("\n");
  const kept = lines.filter((line) => {
    for (const match of line.matchAll(SKILL_FOLDER_REFERENCE_RE)) {
      if (pluginGateExcludesWorkspacePath(gate, `skills/${match[1]}/`)) {
        return false;
      }
    }
    return true;
  });
  if (kept.length === lines.length) return { content, changed: false };
  return { content: kept.join("\n"), changed: true };
}

// ---------------------------------------------------------------------------
// Dispatch-side shared chokepoint (consumed by BOTH payload builders)
// ---------------------------------------------------------------------------

/** Structural subset of EffectiveWorkspacePolicy the MCP filter needs. */
export interface WorkspaceMcpPolicyView {
  mcpAllowedServers: string[] | null;
  mcpBlockedServers: string[];
}

/**
 * The single TOOLS.md MCP policy filter applied to resolved MCP configs
 * in BOTH dispatch paths (chat-agent-invoke and wakeup-processor).
 * Behavior-preserving extraction of the previously duplicated inline
 * filters: a server is dropped when the effective workspace policy
 * blocklists its name, or when an allowlist exists and omits it. A null
 * policy (no rendered workspace) passes everything through.
 *
 * Plugin activation gating for MCP does NOT live here — it is applied
 * upstream inside `buildMcpConfigs` (U6), keyed on the same
 * requesterUserId both builders pass. This filter is the shared
 * chokepoint that keeps the post-resolution policy pass from drifting
 * between the two builders.
 */
export function applyWorkspaceMcpPolicyFilter<T extends { name: string }>(
  configs: T[],
  policy: WorkspaceMcpPolicyView | null | undefined,
): T[] {
  return configs.filter((config) => {
    if (policy?.mcpBlockedServers.includes(config.name)) {
      return false;
    }
    if (
      policy?.mcpAllowedServers &&
      !policy.mcpAllowedServers.includes(config.name)
    ) {
      return false;
    }
    return true;
  });
}
