export interface WorkspacePolicyInput {
  agentBlockedTools?: unknown;
  agentAllowedTools?: unknown;
  modelRoutingSources?: WorkspaceModelRoutingSource[];
}

export type WorkspaceModelRoutingSourceOwner =
  | "agent"
  | "space"
  | "workspace"
  | "user";

export interface WorkspaceModelRoutingRouteInput {
  tool: string;
  match: Record<string, string>;
  model: string;
  reason?: string;
}

export interface WorkspaceModelRoutingSource {
  owner: WorkspaceModelRoutingSourceOwner;
  sourcePath: string;
  precedence: number;
  routes: WorkspaceModelRoutingRouteInput[];
  diagnostics?: string[];
}

export interface EffectiveWorkspaceModelRoutingEntry {
  tool: string;
  match: Record<string, string>;
  model: string;
  sourcePath: string;
  sourceOwner: WorkspaceModelRoutingSourceOwner;
  precedence: number;
  reason?: string;
}

export interface EffectiveWorkspacePolicy {
  blockedTools: string[];
  allowedTools: string[] | null;
  // THINK-302 U6 (R21): retained on the shape for the compile-side mcp policy
  // pass + inspector, but now ALWAYS empty — space mcp_policy is retired, so
  // no server is ever allow/blocklisted here. Removal of the fields entirely is
  // a deferred follow-up once the compile mcp-policy pass is also retired.
  mcpAllowedServers: string[] | null;
  mcpBlockedServers: string[];
  modelRouting: EffectiveWorkspaceModelRoutingEntry[];
  diagnostics: string[];
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

function modelRouteKey(route: WorkspaceModelRoutingRouteInput): string {
  const matchSignature = Object.entries(route.match)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return `${route.tool}\u0000${matchSignature}`;
}

function composeModelRouting(
  sources: WorkspaceModelRoutingSource[] | undefined,
  diagnostics: string[],
): EffectiveWorkspaceModelRoutingEntry[] {
  const routesByKey = new Map<string, EffectiveWorkspaceModelRoutingEntry>();
  for (const source of [...(sources ?? [])].sort(
    (left, right) => left.precedence - right.precedence,
  )) {
    diagnostics.push(...(source.diagnostics ?? []));
    for (const route of source.routes) {
      routesByKey.set(modelRouteKey(route), {
        tool: route.tool,
        match: { ...route.match },
        model: route.model,
        sourcePath: source.sourcePath,
        sourceOwner: source.owner,
        precedence: source.precedence,
        ...(route.reason ? { reason: route.reason } : {}),
      });
    }
  }

  return Array.from(routesByKey.values()).sort((left, right) => {
    const toolCompare = left.tool.localeCompare(right.tool);
    if (toolCompare !== 0) return toolCompare;
    return modelRouteKey(left).localeCompare(modelRouteKey(right));
  });
}

export function composeWorkspacePolicy(
  input: WorkspacePolicyInput,
): EffectiveWorkspacePolicy {
  // THINK-302 U6 (R21): space tool_policy/mcp_policy are retired — the
  // effective policy is now the agent-scope tool policy plus model routing.
  // (Space/user capability scoping is expressed as folder GRANTS via the
  // registry-trust path, not subtractive policy.)
  const blockedTools = stringArray(input.agentBlockedTools);
  const allowedTools = nullableStringArray(input.agentAllowedTools);

  const diagnostics: string[] = [];
  if (
    allowedTools &&
    blockedTools.some((tool) => allowedTools.includes(tool))
  ) {
    diagnostics.push("blocked_tools_take_precedence_over_allowed_tools");
  }
  const modelRouting = composeModelRouting(
    input.modelRoutingSources,
    diagnostics,
  );

  return {
    blockedTools,
    allowedTools,
    mcpAllowedServers: null,
    mcpBlockedServers: [],
    modelRouting,
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
