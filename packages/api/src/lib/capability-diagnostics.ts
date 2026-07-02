/**
 * Capability diagnostics taxonomy (capability-mapping plan U1).
 *
 * ONE enumerated vocabulary for "why is this capability not active" across
 * every gate the composition path applies. The runtime-config resolver
 * (`resolve-agent-runtime-config.ts`) emits these rows into an opt-in
 * collector; the capability inspector (U3) renders them verbatim. Reasons
 * mirror the REAL gates — same conditions, same names — never a softer
 * UI-only approximation (see
 * docs/solutions/architecture-patterns/skill-eval-rated-does-not-mean-evaluable-2026-06-15.md).
 *
 * Extension reason strings `unavailable_provider` / `missing_granted_provider`
 * intentionally reuse the container's own skip reasons
 * (packages/agentcore-pi/agent-container/src/runtime/dynamic-extensions.ts)
 * because the composer predicts those gates from the same descriptor fields
 * the container checks. `extension_runner_disabled` is container-side only
 * (the composer cannot see the runner flag) and is emitted exclusively by the
 * Phase C observed manifest, never by the predicted set.
 */

import type { PluginActivationGate } from "./plugins/gating.js";

export type CapabilityClass =
  | "skill"
  | "builtin_tool"
  | "mcp_server"
  | "pi_extension"
  | "plugin"
  | "agent_profile"
  | "context";

export const CAPABILITY_DROP_REASONS = [
  /** Inventory-diff only (U3): the capability exists in the tenant pool but never entered resolution. */
  "not_installed",
  /** Catalog skill removed by the runtime trust gate (skill-trust/runtime-gate.ts). */
  "trust_gate",
  /** Skill removed by an eval gate. Reserved — no composer-side eval gate exists today. */
  "eval_gate",
  /** Per-skill OAuth env resolution failed (buildSkillEnvOverrides threw); skill ships without its OAuth env. */
  "oauth_missing",
  /** Plugin-owned capability excluded because the requester holds no active activation. */
  "plugin_activation_missing",
  /** Plugin gate resolution failed or no requester was resolvable; all plugin-namespaced folders excluded. */
  "plugin_gate_fail_closed",
  /** Removed by a blocked-tools policy (agent blocked_tools, or a space/workspace blocklist). */
  "blocked_by_policy",
  /** Removed because an allowlist exists and omits it. */
  "allowlist_miss",
  /** Agent Profile row is disabled. */
  "profile_disabled",
  /** Agent Profile skipped because its model is not in the tenant model catalog. */
  "model_unavailable",
  /** Profile (or profile-targeted capability) not active for the selected Space. */
  "space_mismatch",
  /** Central profile dropped because a space-local profile with the same slug is active. */
  "shadowed_by_space_local",
  /** Profile tool_policy names an MCP server that did not resolve (unknown slug or no runtime config). */
  "mcp_server_not_resolved",
  /** Pi extension assignment row is disabled. */
  "extension_disabled",
  /** Pi extension version status is not `approved`. */
  "extension_not_approved",
  /** Pi extension failed a composer-side integrity/validation check (detail carries the specific check). */
  "extension_validation_failed",
  /** Container gate prediction: extension requests more permission classes than were granted. */
  "missing_granted_provider",
  /** Container gate prediction: granted permission classes have no runtime provider yet (THINK-123). */
  "unavailable_provider",
  /** Container-side only: the dynamic-extension runner is disabled. Observed manifests, never predictions. */
  "extension_runner_disabled",
  /** A resolution step errored and degraded (e.g. extension assignment query failed → zero extensions). */
  "resolution_fault",
] as const;

export type CapabilityDropReason = (typeof CAPABILITY_DROP_REASONS)[number];

export interface CapabilityDiagnostic {
  capabilityClass: CapabilityClass;
  /** Slug / server name / extension assignment id / plugin folder prefix — the item's stable id. */
  capabilityId: string;
  displayName?: string;
  reason: CapabilityDropReason;
  /** Free-text specifics (the exact skip condition, the blocking layer, the error message). */
  detail?: string;
}

export interface CapabilityDiagnosticsCollector {
  readonly drops: CapabilityDiagnostic[];
  add(diagnostic: CapabilityDiagnostic): void;
}

export function createCapabilityDiagnostics(): CapabilityDiagnosticsCollector {
  const drops: CapabilityDiagnostic[] = [];
  return {
    drops,
    add(diagnostic) {
      drops.push(diagnostic);
    },
  };
}

/**
 * Expose a resolved plugin activation gate's exclusions as diagnostic rows.
 * Fail-closed (no requester / gate fault) renders one row; a normally
 * resolved gate renders one row per excluded skill-folder prefix.
 */
export function pluginGateCapabilityDiagnostics(
  gate: PluginActivationGate,
): CapabilityDiagnostic[] {
  if (gate.blockAllNamespacedPluginFolders) {
    return [
      {
        capabilityClass: "plugin",
        capabilityId: "*",
        reason: "plugin_gate_fail_closed",
        detail:
          "no resolvable requester or gate resolution fault; every plugin-namespaced skill folder is excluded",
      },
    ];
  }
  return gate.blockedSkillFolderPrefixes.map((prefix) => ({
    capabilityClass: "plugin",
    capabilityId: prefix,
    reason: "plugin_activation_missing" as const,
    detail: "requester holds no active activation for this plugin install",
  }));
}
