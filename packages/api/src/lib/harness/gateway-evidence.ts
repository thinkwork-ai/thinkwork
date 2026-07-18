import { createHash, randomUUID } from "node:crypto";

const MAX_GATEWAY_RESPONSE_BYTES = 512 * 1024;
const MAX_EVIDENCE_BYTES = 96 * 1024;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_CHARS = 20_000;
const READ_TOOL =
  /(?:^|[_./-])(?:find|get|list|read|search|query|fetch)(?:_|[A-Z]|$)/i;
const DEFAULT_CRM_SELECT_FIELDS = [
  "id",
  "name",
  "stage",
  "amount",
  "closeDate",
  "owner",
  "company",
] as const;

export interface GatewayEvidenceProfile {
  gatewayUrl: string;
  gatewayTargetName: string;
}

export interface GatewayAssertion {
  token: string;
  expiresAt: number;
  jti: string;
}

export interface GatewayEvidenceDeps {
  /** Resolve one short-lived AgentCore Identity OBO token for Gateway. */
  mintAssertion(input: {
    tenantId: string;
    turnId: string;
    operation: string;
    toolUseId: string;
    inputHash: string;
  }): Promise<GatewayAssertion>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface GovernedConnectorEvidence {
  connector: string;
  tool: string;
  evidence: unknown;
}

interface GatewayToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function inputHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

async function initializeGatewaySession(input: {
  profile: GatewayEvidenceProfile;
  deps: Pick<GatewayEvidenceDeps, "fetch">;
  accessToken: string;
}): Promise<string> {
  const params = {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "thinkwork-harness-runner", version: "1" },
  };
  const requestId = randomUUID();
  const response = await input.deps.fetch(input.profile.gatewayUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method: "initialize",
      params,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `AgentCore Gateway session initialization failed (${response.status})`,
    );
  }
  const sessionId = response.headers.get("mcp-session-id")?.trim();
  if (!sessionId) {
    throw new Error("AgentCore Gateway initialization returned no session id");
  }
  try {
    unwrapGatewayResult(JSON.parse(raw));
  } catch {
    throw new Error("AgentCore Gateway initialization returned invalid JSON");
  }
  const initialized = await input.deps.fetch(input.profile.gatewayUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!initialized.ok) {
    throw new Error(
      `AgentCore Gateway session acknowledgement failed (${initialized.status})`,
    );
  }
  return sessionId;
}

function parseJsonString(value: string): unknown {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  if (!candidate || !["{", "[", '"'].includes(candidate[0] ?? "")) {
    return value;
  }
  try {
    return JSON.parse(candidate);
  } catch {
    return value;
  }
}

/** Unwrap the JSON-RPC/MCP text envelope returned by an AgentCore Gateway. */
export function unwrapGatewayResult(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current === "string") {
      const parsed = parseJsonString(current);
      if (parsed === current) return current;
      current = parsed;
      continue;
    }
    if (!isRecord(current)) return current;
    if (isRecord(current.error)) {
      const code = String(current.error.code ?? "gateway_error");
      throw new Error(`AgentCore Gateway rejected the operation (${code})`);
    }
    if (current.body !== undefined) {
      current = current.body;
      continue;
    }
    if (current.structuredContent !== undefined) {
      current = current.structuredContent;
      continue;
    }
    if (
      current.result !== undefined &&
      !Array.isArray(current.result) &&
      (current.jsonrpc === "2.0" ||
        Object.keys(current).every((key) => ["id", "result"].includes(key)))
    ) {
      current = current.result;
      continue;
    }
    if (Array.isArray(current.content)) {
      const texts = current.content
        .filter(isRecord)
        .map((block) => block.text)
        .filter((text): text is string => typeof text === "string");
      if (texts.length === 1) {
        current = texts[0];
        continue;
      }
    }
    return current;
  }
  throw new Error("AgentCore Gateway returned an excessively nested response");
}

async function callGatewayTool(input: {
  profile: GatewayEvidenceProfile;
  deps: GatewayEvidenceDeps;
  tenantId: string;
  turnId: string;
  operation: string;
  arguments?: Record<string, unknown>;
  toolName?: string;
  method?: "tools/list" | "tools/call";
  sessionId: string;
  accessToken: string;
}): Promise<unknown> {
  const method = input.method ?? "tools/call";
  const operationInput = input.arguments ?? {};
  const toolUseId = randomUUID();
  const response = await input.deps.fetch(input.profile.gatewayUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "mcp-session-id": input.sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: toolUseId,
      method,
      ...(method === "tools/call"
        ? {
            params: {
              name:
                input.toolName ??
                `${input.profile.gatewayTargetName}___${input.operation}`,
              arguments: operationInput,
            },
          }
        : {}),
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_GATEWAY_RESPONSE_BYTES) {
    throw new Error("AgentCore Gateway response exceeded the evidence ceiling");
  }
  if (!response.ok) {
    let detail = "validation_error";
    try {
      const failure = JSON.parse(raw) as Record<string, unknown>;
      const error = isRecord(failure.error) ? failure.error : failure;
      detail = `${String(error.code ?? "gateway_error")}:${String(
        error.message ?? detail,
      )}`
        .replace(/[^a-zA-Z0-9_.:-]/g, "_")
        .slice(0, 120);
    } catch {
      // Never surface provider bodies. HTTP status + a structured code is
      // sufficient to diagnose Gateway request-shape failures.
    }
    throw new Error(
      `AgentCore Gateway request failed (${response.status}:${detail})`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AgentCore Gateway returned invalid JSON");
  }
  return unwrapGatewayResult(parsed);
}

function gatewayOperationName(value: unknown, suffix: string): string {
  const unwrapped = unwrapGatewayResult(value);
  if (!isRecord(unwrapped) || !Array.isArray(unwrapped.tools)) {
    const shape = isRecord(unwrapped)
      ? Object.fromEntries(
          Object.entries(unwrapped).map(([key, child]) => [
            key,
            Array.isArray(child)
              ? `array:${child.length}`
              : child === null
                ? "null"
                : typeof child,
          ]),
        )
      : { root: typeof unwrapped };
    throw new Error(
      `AgentCore Gateway returned no governed tool catalog (${JSON.stringify(shape)})`,
    );
  }
  const expected = `___${suffix}`;
  const match = unwrapped.tools
    .filter(isRecord)
    .map((tool) => tool.name)
    .find(
      (name): name is string =>
        typeof name === "string" && name.endsWith(expected),
    );
  if (!match) {
    throw new Error(`AgentCore Gateway omitted required operation ${suffix}`);
  }
  return match;
}

function readTools(value: unknown): GatewayToolDefinition[] {
  const unwrapped = unwrapGatewayResult(value);
  if (!isRecord(unwrapped) || !Array.isArray(unwrapped.tools)) {
    const shape = isRecord(unwrapped)
      ? Object.fromEntries(
          Object.entries(unwrapped).map(([key, child]) => [
            key,
            Array.isArray(child) ? `array:${child.length}` : typeof child,
          ]),
        )
      : { root: typeof unwrapped };
    const preview =
      typeof unwrapped === "string"
        ? unwrapped
            .slice(0, 300)
            .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer_[redacted]")
            .replace(/[^a-zA-Z0-9_{}[\]():., -]/g, "_")
        : "";
    throw new Error(
      `AgentCore Gateway tool discovery returned no tool list (${JSON.stringify(shape)}${preview ? `:${preview}` : ""})`,
    );
  }
  return unwrapped.tools
    .filter(isRecord)
    .filter((tool) => typeof tool.name === "string")
    .map((tool) => ({
      name: String(tool.name),
      ...(typeof tool.description === "string"
        ? { description: tool.description }
        : {}),
      ...(isRecord(tool.inputSchema) ? { inputSchema: tool.inputSchema } : {}),
    }));
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2),
  );
}

/** Choose only a read-shaped tool, ranked against the user's exact task. */
export function selectEvidenceTool(
  tools: GatewayToolDefinition[],
  query: string,
): GatewayToolDefinition {
  const queryTokens = tokens(query);
  const readTools = tools.filter((tool) => READ_TOOL.test(tool.name));
  const ranked = readTools
    .map((tool) => {
      const haystack = tokens(`${tool.name} ${tool.description ?? ""}`);
      let score = 0;
      for (const token of queryTokens) if (haystack.has(token)) score += 1;
      if (/opportunit/i.test(query) && /opportunit/i.test(tool.name))
        score += 20;
      if (
        /opportunit/i.test(query) &&
        /(?:^|_)find_many_opportunities$/i.test(tool.name)
      ) {
        score += 40;
      }
      if (
        !/layer/i.test(query) &&
        /(?:^|_)opportunity_layers?$/i.test(tool.name)
      ) {
        score -= 30;
      }
      if (
        /customer|account|qbr/i.test(query) &&
        /compan|account/i.test(tool.name)
      ) {
        score += 10;
      }
      return { tool, score };
    })
    .sort(
      (a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name),
    );
  if (!ranked[0] || ranked[0].score <= 0) {
    throw new Error(
      `No authorized read tool matched the requested report evidence (${
        tools
          .map((tool) => tool.name)
          .slice(0, 8)
          .join(",") || "none"
      })`,
    );
  }
  return ranked[0].tool;
}

function schemaValue(
  schema: Record<string, unknown>,
  property: string,
): unknown {
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0)
    return schema.enum[0];
  const type = schema.type;
  if (type === "number" || type === "integer") {
    return /limit|count|size|first|max/i.test(property) ? 50 : 0;
  }
  if (type === "boolean") return false;
  if (type === "array") {
    if (/^select$/i.test(property)) return schemaSelectFields(schema);
    return [];
  }
  if (type === "object") return {};
  if (type === "string" && /query|search|term/i.test(property)) return "";
  return undefined;
}

function schemaSelectFields(schema: Record<string, unknown>): string[] {
  const items = isRecord(schema.items) ? schema.items : {};
  const declared = new Set<string>();
  const addValues = (value: unknown) => {
    if (typeof value === "string" && value.trim()) declared.add(value.trim());
    if (Array.isArray(value)) value.forEach(addValues);
  };
  addValues(items.enum);
  for (const variant of [items.oneOf, items.anyOf]) {
    if (!Array.isArray(variant)) continue;
    for (const candidate of variant.filter(isRecord)) {
      addValues(candidate.const);
      addValues(candidate.enum);
    }
  }
  if (declared.size > 0) {
    const preferred = DEFAULT_CRM_SELECT_FIELDS.filter((field) =>
      declared.has(field),
    );
    return (preferred.length > 0 ? preferred : [...declared]).slice(0, 20);
  }
  // Universal datasource tools expose `select` as an array of field names.
  // The schema is intentionally open because Twenty workspaces can add custom
  // fields, but the standard record fields below are stable and read-only.
  return [...DEFAULT_CRM_SELECT_FIELDS];
}

/** Build a bounded read request without asking the model to invent arguments. */
export function buildEvidenceArguments(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!schema) return {};
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter(
          (name): name is string => typeof name === "string",
        )
      : [],
  );
  const args: Record<string, unknown> = {};
  for (const [name, candidate] of Object.entries(properties)) {
    if (!isRecord(candidate)) continue;
    const value = schemaValue(candidate, name);
    if (
      value !== undefined &&
      (required.has(name) || /limit|count|size|first|max/i.test(name))
    ) {
      args[name] = value;
    }
  }
  const unresolved = [...required].filter((name) => args[name] === undefined);
  if (unresolved.length > 0) {
    throw new Error(
      `Authorized evidence tool requires unsupported arguments: ${unresolved.join(", ")}`,
    );
  }
  return args;
}

function deterministicEvidenceRecipe(
  connector: string,
  query: string,
): GatewayToolDefinition | null {
  if (/twenty.*crm|crm.*twenty/i.test(connector) && /opportunit/i.test(query)) {
    return {
      name: "find_many_opportunities",
      description: "Read Twenty CRM opportunity records",
      inputSchema: {
        type: "object",
        required: ["select", "limit", "offset"],
        properties: {
          select: { type: "array", items: { type: "string" } },
          limit: { type: "integer", default: 20 },
          offset: { type: "integer", default: 0 },
        },
      },
    };
  }
  return null;
}

function compact(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[depth-limited]";
  if (typeof value === "string") {
    const parsed = parseJsonString(value);
    if (parsed !== value) return compact(parsed, depth + 1);
    return value.length > MAX_STRING_CHARS
      ? `${value.slice(0, MAX_STRING_CHARS)}…[truncated]`
      : value;
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => compact(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push({ truncated_items: value.length - MAX_ARRAY_ITEMS });
    }
    return items;
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 200)
      .map(([key, child]) => [key, compact(child, depth + 1)]),
  );
}

function providerError(value: unknown, depth = 0): string | null {
  if (depth > 12) return null;
  if (typeof value === "string") {
    const parsed = parseJsonString(value);
    if (parsed !== value) return providerError(parsed, depth + 1);
    const message = value.trim();
    if (
      message.length <= 500 &&
      /^(?:error\b|failed\b|invalid\b|unauthorized\b|forbidden\b|[a-zA-Z0-9_.-]+ is required\b)/i.test(
        message,
      )
    ) {
      return message.slice(0, 160);
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const error = providerError(child, depth + 1);
      if (error) return error;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.isError === true || value.success === false) {
    return "provider_reported_error";
  }
  if (value.error !== undefined && value.error !== null) {
    return providerError(value.error, depth + 1) ?? "provider_reported_error";
  }
  for (const child of Object.values(value)) {
    const error = providerError(child, depth + 1);
    if (error) return error;
  }
  return null;
}

export async function collectGovernedConnectorEvidence(input: {
  profile: GatewayEvidenceProfile;
  deps: GatewayEvidenceDeps;
  tenantId: string;
  turnId: string;
  connector: string;
  query: string;
}): Promise<GovernedConnectorEvidence> {
  const tokenUseId = randomUUID();
  const access = await input.deps.mintAssertion({
    tenantId: input.tenantId,
    turnId: input.turnId,
    operation: "gateway_session",
    toolUseId: tokenUseId,
    inputHash: inputHash({ connector: input.connector, query: input.query }),
  });
  const accessToken = access.token;
  const sessionId = await initializeGatewaySession({
    profile: input.profile,
    deps: input.deps,
    accessToken,
  });
  // Resolve the live Gateway namespace instead of assuming whether AgentCore
  // prefixes OpenAPI operations with the target name or generated target id.
  const gatewayCatalog = await callGatewayTool({
    ...input,
    operation: "tools_list",
    method: "tools/list",
    sessionId,
    accessToken,
  });
  const callOperationName = gatewayOperationName(
    gatewayCatalog,
    "call_connector_tool",
  );
  const discoveryArgs = {
    tenant_id: input.tenantId,
    connector: input.connector,
    query: input.query,
  };
  const recipe = deterministicEvidenceRecipe(input.connector, input.query);
  let tool = recipe;
  if (!tool) {
    const listOperationName = gatewayOperationName(
      gatewayCatalog,
      "list_connector_tools",
    );
    const discovery = await callGatewayTool({
      ...input,
      operation: "list_connector_tools",
      arguments: discoveryArgs,
      toolName: listOperationName,
      sessionId,
      accessToken,
    });
    tool = selectEvidenceTool(readTools(discovery), input.query);
  }
  const callArgs = {
    ...discoveryArgs,
    tool: tool.name,
    arguments: buildEvidenceArguments(tool.inputSchema),
  };
  const called = await callGatewayTool({
    ...input,
    operation: "call_connector_tool",
    arguments: callArgs,
    toolName: callOperationName,
    sessionId,
    accessToken,
  });
  const evidence = compact(called);
  const reportedError = providerError(evidence);
  if (reportedError) {
    throw new Error(
      `Governed connector returned unusable evidence (${reportedError
        .replace(/[^a-zA-Z0-9_.:-]/g, "_")
        .slice(0, 120)})`,
    );
  }
  if (
    Buffer.byteLength(JSON.stringify(evidence), "utf8") > MAX_EVIDENCE_BYTES
  ) {
    throw new Error(
      "Governed connector evidence exceeded the composition ceiling",
    );
  }
  return { connector: input.connector, tool: tool.name, evidence };
}
