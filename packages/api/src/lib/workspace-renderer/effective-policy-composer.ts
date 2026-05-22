export interface WorkspacePolicyInput {
  agentBlockedTools?: unknown;
  agentAllowedTools?: unknown;
  spaceToolPolicy?: unknown;
  spaceMcpPolicy?: unknown;
}

export interface EffectiveWorkspacePolicy {
  blockedTools: string[];
  allowedTools: string[] | null;
  mcpAllowedServers: string[] | null;
  mcpBlockedServers: string[];
  diagnostics: string[];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).sort();
}

function nullableStringArray(value: unknown): string[] | null {
  const values = stringArray(value);
  return values.length > 0 ? values : null;
}

function intersectNullable(
  left: string[] | null,
  right: string[] | null,
): string[] | null {
  if (!left && !right) return null;
  if (!left) return right;
  if (!right) return left;
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item)).sort();
}

export function composeWorkspacePolicy(
  input: WorkspacePolicyInput,
): EffectiveWorkspacePolicy {
  const toolPolicy = asObject(input.spaceToolPolicy);
  const mcpPolicy = asObject(input.spaceMcpPolicy);
  const agentBlocked = stringArray(input.agentBlockedTools);
  const spaceBlocked = stringArray(toolPolicy.blockedTools);
  const blockedTools = Array.from(
    new Set([...agentBlocked, ...spaceBlocked]),
  ).sort();

  const agentAllowed = nullableStringArray(input.agentAllowedTools);
  const spaceAllowed = nullableStringArray(toolPolicy.allowedTools);
  const allowedTools = intersectNullable(agentAllowed, spaceAllowed);

  const diagnostics: string[] = [];
  if (agentBlocked.length > 0 && spaceBlocked.length > 0) {
    diagnostics.push("agent_and_space_blocked_tools_union_applied");
  }
  if (
    allowedTools &&
    blockedTools.some((tool) => allowedTools.includes(tool))
  ) {
    diagnostics.push("blocked_tools_take_precedence_over_allowed_tools");
  }

  return {
    blockedTools,
    allowedTools,
    mcpAllowedServers: nullableStringArray(mcpPolicy.allowedServers),
    mcpBlockedServers: stringArray(mcpPolicy.blockedServers),
    diagnostics,
  };
}

export function isToolAllowed(
  policy: EffectiveWorkspacePolicy,
  toolName: string,
): boolean {
  if (policy.blockedTools.includes(toolName)) return false;
  if (policy.allowedTools && !policy.allowedTools.includes(toolName)) {
    return false;
  }
  return true;
}
