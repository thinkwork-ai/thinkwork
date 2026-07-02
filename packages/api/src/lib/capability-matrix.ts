/**
 * Capability assignment matrix vocabulary (capability-mapping plan U7, R2).
 *
 * Runtime mirror of the ASSIGNMENT cells in the reviewed matrix contract at
 * docs/src/content/docs/concepts/capability-matrix.mdx — the class × layer
 * combinations a grant/detach mutation may touch. The mutation layer is the
 * R2 enforcement point (KTD-5): every write surface (web, CLI, agent
 * proposals) goes through `grantCapability`/`detachCapability`, so rejecting
 * an unassignable cell here covers them all.
 *
 * Grant scopes are agent and agent-profile only (R11). Space layers CARRY
 * capabilities through their folder (files, skills) and RESTRICT through
 * policy — both filesystem-authoritative, neither a grant. User layers are
 * self-serve connections (OAuth, plugin activations), never operator grants.
 *
 * Changing a cell here is a matrix change: update the doc in the same PR
 * (the capability-matrix CI workflow anchors the review).
 */

export const CAPABILITY_GRANT_CLASSES = [
  "skill",
  "mcp_server",
  "pi_extension",
] as const;
export type CapabilityGrantClass = (typeof CAPABILITY_GRANT_CLASSES)[number];

export const CAPABILITY_GRANT_SCOPES = [
  "agent",
  "agent_profile",
  "space",
  "user",
] as const;
export type CapabilityGrantScope = (typeof CAPABILITY_GRANT_SCOPES)[number];

/** Matrix row: which scopes each grantable class may be assigned at. */
const ASSIGNABLE_SCOPES: Record<
  CapabilityGrantClass,
  ReadonlySet<CapabilityGrantScope>
> = {
  // Skills: Grant at agent (catalog install → workspace folder) and profile
  // (skill_policy subset). Space skills are carried by the space folder.
  skill: new Set(["agent", "agent_profile"]),
  // MCP servers: Grant at agent (registry assignment) and profile
  // (tool_policy.mcpServers subset). Space is restrict-only; user is
  // self-serve OAuth.
  mcp_server: new Set(["agent", "agent_profile"]),
  // Dynamic Pi extensions: Grant at agent (target default_agent) and
  // profile (target agent_profile). Never space, never user.
  pi_extension: new Set(["agent", "agent_profile"]),
};

export class CapabilityMatrixViolationError extends Error {
  readonly code = "MATRIX_VIOLATION";
  constructor(
    readonly capabilityClass: CapabilityGrantClass,
    readonly scope: CapabilityGrantScope,
  ) {
    super(
      `the capability matrix marks ${capabilityClass} unassignable at ${scope} scope ` +
        `(grants exist only at agent and agent-profile scope — ` +
        `see docs/src/content/docs/concepts/capability-matrix.mdx)`,
    );
    this.name = "CapabilityMatrixViolationError";
  }
}

/** R2 enforcement point: throws on any cell the matrix marks unassignable. */
export function assertAssignableCell(
  capabilityClass: CapabilityGrantClass,
  scope: CapabilityGrantScope,
): void {
  if (!ASSIGNABLE_SCOPES[capabilityClass]?.has(scope)) {
    throw new CapabilityMatrixViolationError(capabilityClass, scope);
  }
}
