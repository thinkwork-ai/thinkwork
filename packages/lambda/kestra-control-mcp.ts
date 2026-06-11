import { getApiAuthSecret } from "@thinkwork/runtime-config";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { tenantMcpAdminKeys } from "@thinkwork/database-pg/schema";
import {
  KestraApiError,
  createKestraClientFromEnv,
} from "./kestra-control-client.js";
import type { KestraClient } from "./kestra-control-client.js";
import {
  evaluateKestraFlowPolicy,
  validateKestraNamespace,
} from "./kestra-control-policy.js";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "thinkwork-kestra-control";
const SERVER_VERSION = "0.1.0";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const JsonRpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

type KestraToolClient = Pick<
  KestraClient,
  | "namespacesList"
  | "flowGet"
  | "flowUpsert"
  | "executionStart"
  | "executionGet"
  | "executionLogs"
>;

type KestraControlDependencies = {
  clientFactory?: () => Promise<KestraToolClient>;
  bearerVerifier?: (
    event: APIGatewayProxyEventV2,
  ) => Promise<boolean> | boolean;
};

export function createKestraControlMcpHandler(
  dependencies: KestraControlDependencies = {},
) {
  const clientFactory =
    dependencies.clientFactory ?? (() => createKestraClientFromEnv());
  const bearerVerifier = dependencies.bearerVerifier ?? verifyBearerToken;

  return async function handler(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const method = event.requestContext.http.method;

    if (method === "OPTIONS") {
      return {
        statusCode: 204,
        headers: corsHeaders(),
        body: "",
      };
    }

    if (method !== "POST") {
      return httpJson(405, { error: "Method not allowed - POST only" });
    }

    if (!(await bearerVerifier(event))) {
      return httpJson(401, { error: "Unauthorized" });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(event.body ?? "");
    } catch {
      return httpJson(200, {
        jsonrpc: "2.0",
        id: null,
        error: { code: JsonRpcErrorCode.ParseError, message: "Invalid JSON" },
      });
    }

    const tools = buildTools(clientFactory);

    if (Array.isArray(parsed)) {
      const responses = (
        await Promise.all(
          (parsed as JsonRpcRequest[]).map((request) =>
            dispatch(request, tools),
          ),
        )
      ).filter((response): response is JsonRpcResponse => response !== null);
      return httpJson(200, responses);
    }

    const response = await dispatch(parsed as JsonRpcRequest, tools);
    if (response === null) {
      return {
        statusCode: 202,
        headers: corsHeaders(),
        body: "",
      };
    }
    return httpJson(200, response);
  };
}

export const handler = createKestraControlMcpHandler();

export function buildTools(
  clientFactory: () => Promise<KestraToolClient>,
): ToolDefinition[] {
  const namespacePrefix =
    process.env.KESTRA_ALLOWED_NAMESPACE_PREFIX || "thinkwork";
  const policyOptions = { allowedNamespacePrefix: namespacePrefix };

  return [
    {
      name: "kestra_namespaces_list",
      description:
        "List namespaces visible to the managed Kestra service credential.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async handler(args) {
        audit("kestra_namespaces_list", args);
        const client = await clientFactory();
        return { namespaces: await client.namespacesList() };
      },
    },
    {
      name: "kestra_flows_get",
      description:
        "Fetch one Kestra flow by namespace and id. Reads are allowed only through the managed Kestra service credential.",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string" },
          flowId: { type: "string" },
        },
        required: ["namespace", "flowId"],
        additionalProperties: false,
      },
      async handler(args) {
        const { namespace, flowId } = requireStrings(args, [
          "namespace",
          "flowId",
        ]);
        audit("kestra_flows_get", args, { namespace, flowId });
        const client = await clientFactory();
        return { flow: await client.flowGet(namespace, flowId) };
      },
    },
    {
      name: "kestra_flows_validate",
      description:
        "Validate a Kestra flow YAML document against ThinkWork managed-runtime namespace and task policy without mutating Kestra.",
      inputSchema: {
        type: "object",
        properties: {
          source: {
            type: "string",
            description: "Kestra flow YAML source.",
          },
        },
        required: ["source"],
        additionalProperties: false,
      },
      async handler(args) {
        const { source } = requireStrings(args, ["source"]);
        const result = evaluateKestraFlowPolicy(source, policyOptions);
        audit("kestra_flows_validate", args, {
          namespace: result.namespace ?? undefined,
          flowId: result.flowId ?? undefined,
          valid: result.ok,
        });
        return {
          valid: result.ok,
          namespace: result.namespace,
          flowId: result.flowId,
          errors: result.errors,
          warnings: result.warnings,
          namespacePolicy: {
            allowedPrefix: namespacePrefix,
          },
        };
      },
    },
    {
      name: "kestra_flows_upsert",
      description:
        "Create or update a Kestra flow from YAML after enforcing the ThinkWork managed-runtime namespace and task policy.",
      inputSchema: {
        type: "object",
        properties: {
          source: {
            type: "string",
            description: "Kestra flow YAML source.",
          },
        },
        required: ["source"],
        additionalProperties: false,
      },
      async handler(args) {
        const { source } = requireStrings(args, ["source"]);
        const policy = evaluateKestraFlowPolicy(source, policyOptions);
        if (!policy.ok) {
          throw new Error(`flow policy rejected: ${policy.errors.join("; ")}`);
        }
        audit("kestra_flows_upsert", args, {
          namespace: policy.namespace ?? undefined,
          flowId: policy.flowId ?? undefined,
        });
        const client = await clientFactory();
        const flow = await client.flowUpsert(source);
        return {
          namespace: policy.namespace,
          flowId: policy.flowId,
          flow,
          warnings: policy.warnings,
        };
      },
    },
    {
      name: "kestra_executions_start",
      description:
        "Start a Kestra flow execution in an allowed ThinkWork-managed namespace.",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string" },
          flowId: { type: "string" },
          inputs: {
            type: "object",
            description: "Optional Kestra input values.",
            additionalProperties: true,
          },
        },
        required: ["namespace", "flowId"],
        additionalProperties: false,
      },
      async handler(args) {
        const { namespace, flowId } = requireStrings(args, [
          "namespace",
          "flowId",
        ]);
        const namespacePolicy = validateKestraNamespace(
          namespace,
          policyOptions,
        );
        if (!namespacePolicy.ok) {
          throw new Error(
            `namespace policy rejected: ${namespacePolicy.error}`,
          );
        }
        const inputs = isPlainRecord(args.inputs) ? args.inputs : undefined;
        audit("kestra_executions_start", args, { namespace, flowId });
        const client = await clientFactory();
        const execution = await client.executionStart(
          namespace,
          flowId,
          inputs,
        );
        return {
          namespace,
          flowId,
          execution,
        };
      },
    },
    {
      name: "kestra_executions_get",
      description: "Fetch Kestra execution status and summary by execution id.",
      inputSchema: {
        type: "object",
        properties: {
          executionId: { type: "string" },
        },
        required: ["executionId"],
        additionalProperties: false,
      },
      async handler(args) {
        const { executionId } = requireStrings(args, ["executionId"]);
        audit("kestra_executions_get", args, { executionId });
        const client = await clientFactory();
        return { execution: await client.executionGet(executionId) };
      },
    },
    {
      name: "kestra_executions_logs",
      description: "Fetch log entries for one Kestra execution id.",
      inputSchema: {
        type: "object",
        properties: {
          executionId: { type: "string" },
        },
        required: ["executionId"],
        additionalProperties: false,
      },
      async handler(args) {
        const { executionId } = requireStrings(args, ["executionId"]);
        audit("kestra_executions_logs", args, { executionId });
        const client = await clientFactory();
        return { logs: await client.executionLogs(executionId) };
      },
    },
    {
      name: "kestra_plugins_search",
      description:
        "Return read-only guidance for finding Kestra plugins and blueprints. This tool does not mutate the customer Kestra instance.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        additionalProperties: false,
      },
      async handler(args) {
        audit("kestra_plugins_search", args);
        const query = typeof args.query === "string" ? args.query.trim() : "";
        return {
          query,
          catalog: "https://kestra.io/plugins",
          blueprints: "https://kestra.io/blueprints",
          note: "Use Kestra's public catalog for discovery, then create flows only through kestra_flows_validate and kestra_flows_upsert.",
        };
      },
    },
  ];
}

async function dispatch(
  req: JsonRpcRequest,
  tools: ToolDefinition[],
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const isNotification = req.id === undefined;

  try {
    switch (req.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          },
        };
      case "notifications/initialized":
        return null;
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: tools.map(({ name, description, inputSchema }) => ({
              name,
              description,
              inputSchema,
            })),
          },
        };
      case "tools/call":
        return toolsCall(req, tools);
      default:
        if (isNotification) return null;
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: JsonRpcErrorCode.MethodNotFound,
            message: `Method not found: ${req.method}`,
          },
        };
    }
  } catch (err) {
    if (isNotification) return null;
    const message = err instanceof Error ? err.message : String(err);
    return {
      jsonrpc: "2.0",
      id,
      error: { code: JsonRpcErrorCode.InternalError, message },
    };
  }
}

async function toolsCall(
  req: JsonRpcRequest,
  tools: ToolDefinition[],
): Promise<JsonRpcResponse> {
  const id = req.id ?? null;
  const params = req.params as
    | { name?: string; arguments?: Record<string, unknown> }
    | undefined;
  const toolName = params?.name;
  const toolArgs = params?.arguments ?? {};
  if (!toolName) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: JsonRpcErrorCode.InvalidParams,
        message: "tools/call requires params.name",
      },
    };
  }
  const tool = tools.find((candidate) => candidate.name === toolName);
  if (!tool) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: JsonRpcErrorCode.MethodNotFound,
        message: `Unknown tool: ${toolName}`,
      },
    };
  }
  try {
    const result = await tool.handler(toolArgs);
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: false,
      },
    };
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: JSON.stringify(toolError(err)) }],
        isError: true,
      },
    };
  }
}

function toolError(error: unknown): Record<string, unknown> {
  if (error instanceof KestraApiError) {
    return {
      error: "kestra_api_error",
      status: error.data.status,
      method: error.data.method,
      path: error.data.path,
      message: error.message,
      bodyPreview: error.data.bodyPreview,
    };
  }
  return {
    error: "kestra_control_error",
    message: error instanceof Error ? error.message : String(error),
  };
}

function requireStrings<T extends string>(
  args: Record<string, unknown>,
  keys: T[],
): Record<T, string> {
  const result = {} as Record<T, string>;
  for (const key of keys) {
    const value = args[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`${key} is required`);
    }
    result[key] = value.trim();
  }
  return result;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function audit(
  tool: string,
  args: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
) {
  console.log(
    JSON.stringify({
      event: "kestra_control_mcp_tool",
      tool,
      tenantId: stringValue(args.tenantId),
      agentId: stringValue(args.agentId),
      principalId: stringValue(args.principalId),
      principalEmail: stringValue(args.principalEmail),
      ...metadata,
    }),
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function verifyBearerToken(
  event: APIGatewayProxyEventV2,
): Promise<boolean> {
  const token = extractBearer(event);
  if (!token) return false;

  if (await matchesTenantMcpKey(token)) {
    return true;
  }

  const superSecret = getApiAuthSecret();
  return !!superSecret && token === superSecret;
}

function extractBearer(event: APIGatewayProxyEventV2): string | null {
  const h = event.headers ?? {};
  const raw = h.authorization ?? h.Authorization;
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]! : null;
}

async function matchesTenantMcpKey(token: string): Promise<boolean> {
  const hash = createHash("sha256").update(token).digest("hex");
  try {
    const db = getDb();
    const [row] = await db
      .select({ id: tenantMcpAdminKeys.id })
      .from(tenantMcpAdminKeys)
      .where(
        and(
          eq(tenantMcpAdminKeys.key_hash, hash),
          isNull(tenantMcpAdminKeys.revoked_at),
        ),
      )
      .limit(1);
    if (!row) {
      return false;
    }
    db.update(tenantMcpAdminKeys)
      .set({ last_used_at: new Date() })
      .where(eq(tenantMcpAdminKeys.id, row.id))
      .catch((err: unknown) => {
        console.warn("kestra-control-mcp: last_used_at bump failed", err);
      });
    return true;
  } catch (err) {
    console.error(
      "kestra-control-mcp: key lookup failed (falling back to superuser check)",
      err,
    );
    return false;
  }
}

function httpJson(
  status: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: status,
    headers: corsHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  };
}

function corsHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "*",
    "Access-Control-Allow-Headers": "*",
    ...extra,
  };
}
