export type ModelRoutingSourceOwner = "agent" | "space" | "workspace" | "user";

export interface ModelRoutingRoute {
  tool: string;
  match: Record<string, string>;
  model: string;
  sourcePath?: string;
  sourceOwner?: ModelRoutingSourceOwner;
  precedence?: number;
  reason?: string;
}

export interface ModelRoutingPolicy {
  routes: ModelRoutingRoute[];
}

export interface ModelRoutingDecision {
  route: ModelRoutingRoute;
  ruleSource: {
    path?: string;
    owner?: ModelRoutingSourceOwner;
    precedence?: number;
  };
}

export interface ChildModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  totalTokens?: number;
}

export interface ChildModelCallInput {
  modelId: string;
  systemPrompt: string;
  prompt: string;
  metadata?: Record<string, unknown>;
}

export interface ChildModelCallResult {
  text: string;
  usage?: ChildModelUsage;
  stopReason?: string;
}

export type ChildModelCaller = (
  input: ChildModelCallInput,
) => Promise<ChildModelCallResult>;

export interface ModelRoutedToolCallRecord {
  toolCallId: string;
  toolName: string;
  match: Record<string, string>;
  model: string;
  ruleSource: {
    path?: string;
    owner?: ModelRoutingSourceOwner;
    precedence?: number;
  };
  status: "completed" | "rejected" | "failed";
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  error?: string;
}

export class ModelRoutingPolicyError extends Error {
  constructor(
    public readonly code:
      | "MODEL_ROUTE_UNAPPROVED"
      | "MODEL_ROUTE_CALLER_MISSING"
      | "MODEL_ROUTE_CHILD_FAILED",
    message: string,
    public readonly route?: ModelRoutingRoute,
  ) {
    super(message);
    this.name = "ModelRoutingPolicyError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeMatch(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  const match: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(record)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    if (
      typeof rawValue === "string" ||
      typeof rawValue === "number" ||
      typeof rawValue === "boolean"
    ) {
      match[normalizedKey] = String(rawValue).trim();
    }
  }
  return match;
}

function normalizeSourceOwner(
  value: unknown,
): ModelRoutingSourceOwner | undefined {
  if (
    value === "agent" ||
    value === "space" ||
    value === "workspace" ||
    value === "user"
  ) {
    return value;
  }
  return undefined;
}

export function normalizeModelRoutingPolicy(
  value: unknown,
): ModelRoutingPolicy {
  const rawRoutes = Array.isArray(value)
    ? value
    : Array.isArray(asRecord(value)?.routes)
      ? (asRecord(value)?.routes as unknown[])
      : [];
  const routes = rawRoutes.flatMap((rawRoute): ModelRoutingRoute[] => {
    const route = asRecord(rawRoute);
    if (!route) return [];
    const tool = stringValue(route.tool);
    const model = stringValue(route.model);
    if (!tool || !model) return [];
    return [
      {
        tool,
        model,
        match: normalizeMatch(route.match),
        ...(stringValue(route.sourcePath)
          ? { sourcePath: stringValue(route.sourcePath)! }
          : {}),
        ...(normalizeSourceOwner(route.sourceOwner)
          ? { sourceOwner: normalizeSourceOwner(route.sourceOwner) }
          : {}),
        ...(numberValue(route.precedence) !== undefined
          ? { precedence: numberValue(route.precedence) }
          : {}),
        ...(stringValue(route.reason)
          ? { reason: stringValue(route.reason)! }
          : {}),
      },
    ];
  });
  return { routes };
}

export function normalizeApprovedModelIds(value: unknown): string[] {
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

function routeMatches(
  route: ModelRoutingRoute,
  toolName: string,
  match: Record<string, string>,
): boolean {
  if (route.tool !== toolName) return false;
  return Object.entries(route.match).every(
    ([key, value]) => match[key] === value,
  );
}

export function findModelRoutingDecision(
  policy: ModelRoutingPolicy,
  input: { toolName: string; match: Record<string, string> },
): ModelRoutingDecision | null {
  const candidates = policy.routes.filter((route) =>
    routeMatches(route, input.toolName, input.match),
  );
  if (!candidates.length) return null;
  const route = [...candidates].sort((left, right) => {
    const specificity =
      Object.keys(right.match).length - Object.keys(left.match).length;
    if (specificity !== 0) return specificity;
    return (right.precedence ?? 0) - (left.precedence ?? 0);
  })[0]!;
  return {
    route,
    ruleSource: {
      ...(route.sourcePath ? { path: route.sourcePath } : {}),
      ...(route.sourceOwner ? { owner: route.sourceOwner } : {}),
      ...(route.precedence !== undefined
        ? { precedence: route.precedence }
        : {}),
    },
  };
}

export function assertModelRouteApproved(input: {
  decision: ModelRoutingDecision;
  approvedModelIds: readonly string[];
}): void {
  if (input.approvedModelIds.includes(input.decision.route.model)) return;
  throw new ModelRoutingPolicyError(
    "MODEL_ROUTE_UNAPPROVED",
    `TOOLS.md routed ${input.decision.route.tool} to model "${input.decision.route.model}", but that model is not approved for this user.`,
    input.decision.route,
  );
}
