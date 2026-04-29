/**
 * AgentCore Invoke Lambda
 *
 * Replaces the EC2 tenant router. Receives chat requests from Convex,
 * invokes AgentCore Runtime, and returns the response.
 *
 * Deployed as a Lambda Function URL (not API Gateway) to support
 * long-running invocations (up to 15 minutes).
 */

import { createHash, timingSafeEqual } from "crypto";

interface LambdaEvent {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  requestContext?: { http?: { method?: string; path?: string } };
  rawPath?: string;
}

interface LambdaResult {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

const THINKWORK_API_SECRET = process.env.THINKWORK_API_SECRET || "";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const AGENTCORE_RUNTIME_SSM_PREFIX =
  process.env.AGENTCORE_RUNTIME_SSM_PREFIX || "";

/** Maps agent adapter_type → SSM runtime key suffix. SDK deprecated — all agents use Strands. */
const ADAPTER_TO_RUNTIME: Record<string, string> = {
  strands: "strands",
  sdk: "strands", // Deprecated: SDK agents fall back to Strands
};

/** Cached SSM runtime IDs with TTL (5 min) to pick up runtime version changes */
let cachedRuntimeIds: Record<string, string> | null = null;
let cachedRuntimeIdsAt = 0;
const RUNTIME_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function loadRuntimeIdsFromSsm(): Promise<Record<string, string>> {
  if (
    cachedRuntimeIds &&
    Date.now() - cachedRuntimeIdsAt < RUNTIME_CACHE_TTL_MS
  ) {
    return cachedRuntimeIds;
  }

  if (!AGENTCORE_RUNTIME_SSM_PREFIX) {
    console.warn(
      "AGENTCORE_RUNTIME_SSM_PREFIX not set, cannot load runtime IDs from SSM",
    );
    return {};
  }

  // SSM GetParametersByPath uses hierarchical paths (/ separated), but our
  // params are named like /thinkwork/{stage}/agentcore/runtime-id-chat (not
  // /thinkwork/{stage}/agentcore/runtime-id/chat). Use individual GetParameter
  // calls for each known runtime type instead.
  const { SSMClient, GetParameterCommand } = await import(
    "@aws-sdk/client-ssm"
  );
  const ssm = new SSMClient({ region: AWS_REGION });

  const runtimeKeys = ["sdk", "strands"];
  const result: Record<string, string> = {};

  await Promise.all(
    runtimeKeys.map(async (key) => {
      try {
        const resp = await ssm.send(
          new GetParameterCommand({
            Name: `${AGENTCORE_RUNTIME_SSM_PREFIX}-${key}`,
          }),
        );
        if (resp.Parameter?.Value) {
          result[key] = resp.Parameter.Value;
        }
      } catch (err: unknown) {
        // ParameterNotFound is expected for runtimes not yet provisioned
        const code = (err as { name?: string }).name;
        if (code !== "ParameterNotFound") {
          console.warn(`Failed to load SSM param for runtime '${key}':`, err);
        }
      }
    }),
  );

  console.log(
    `Loaded ${Object.keys(result).length} runtime IDs from SSM:`,
    Object.keys(result),
  );
  cachedRuntimeIds = result;
  cachedRuntimeIdsAt = Date.now();
  return result;
}

function json(statusCode: number, body: unknown): LambdaResult {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function checkAuth(headers?: Record<string, string | undefined>): boolean {
  if (!THINKWORK_API_SECRET) return true; // dev mode — no secret configured
  const auth = headers?.authorization || headers?.Authorization || "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  try {
    return timingSafeEqual(
      Buffer.from(token),
      Buffer.from(THINKWORK_API_SECRET),
    );
  } catch {
    return false;
  }
}

/**
 * Derive a stable session ID from agent + session key.
 * The sessionKey isolates VMs by invocation source:
 *   - "chat"              → one warm VM for interactive chat
 *   - trigger UUID        → one VM per trigger (email check, calendar check, etc.)
 * This lets chat and multiple triggers run concurrently on separate VMs,
 * while still reusing warm VMs within the same source.
 */
function deriveSessionId(
  assistantId: string,
  tenantId: string,
  runtimeType: string = "",
  model: string = "",
  sessionKey: string = "chat",
): string {
  const key = assistantId || tenantId;
  const parts = ["session", key, runtimeType, model, sessionKey].filter(
    Boolean,
  );
  const raw = parts.join(":");
  return createHash("sha256").update(raw).digest("hex").slice(0, 64);
}

async function resolveRuntimeArn(runtimeType: string): Promise<string> {
  const runtimeIds = await loadRuntimeIdsFromSsm();

  // Map adapter_type (e.g. "claude") to SSM key (e.g. "chat")
  const ssmKey = ADAPTER_TO_RUNTIME[runtimeType] || "sdk";
  const runtimeId = runtimeIds[ssmKey] || runtimeIds["sdk"];

  if (!runtimeId) {
    throw new Error(
      `No AgentCore Runtime ID configured for type '${runtimeType}' (SSM key: ${ssmKey})`,
    );
  }

  return `arn:aws:bedrock-agentcore:${AWS_REGION}:${process.env.AWS_ACCOUNT_ID || "487219502366"}:runtime/${runtimeId}`;
}

async function invokeAgentCore(
  payload: Record<string, unknown>,
  runtimeArn: string,
  sessionId: string,
): Promise<Record<string, unknown>> {
  // Dynamic import to avoid cold-start penalty when not needed
  const { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } = await import(
    "@aws-sdk/client-bedrock-agentcore"
  );

  const client = new BedrockAgentCoreClient({
    region: AWS_REGION,
    requestHandler: {
      requestTimeout: 660_000, // 11 minutes — matches Python router
    },
  });

  const command = new InvokeAgentRuntimeCommand({
    agentRuntimeArn: runtimeArn,
    runtimeSessionId: sessionId,
    payload: JSON.stringify(payload),
  });

  const start = Date.now();
  const response = await client.send(command);

  // Response body is a streaming blob — read fully
  const bodyBytes =
    typeof response.response?.transformToByteArray === "function"
      ? await response.response.transformToByteArray()
      : typeof (response.response as any)?.read === "function"
        ? (response.response as any).read()
        : response.response;

  const bodyStr =
    bodyBytes instanceof Uint8Array
      ? new TextDecoder().decode(bodyBytes)
      : typeof bodyBytes === "string"
        ? bodyBytes
        : JSON.stringify(bodyBytes);

  const durationMs = Date.now() - start;
  console.log(
    `AgentCore invocation session_id=${sessionId.slice(0, 16)} duration_ms=${durationMs} status=success`,
  );

  return JSON.parse(bodyStr);
}

export async function handler(event: LambdaEvent): Promise<LambdaResult> {
  const method =
    event.requestContext?.http?.method || (event.body ? "POST" : "GET");

  // Health check
  if (method === "GET") {
    return json(200, { status: "ok", service: "agentcore-invoke" });
  }

  // Auth
  if (!checkAuth(event.headers)) {
    return json(401, { error: "Unauthorized" });
  }

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const tenantId = String(body.tenant_id || "");
  const assistantId = String(body.assistant_id || "");
  const ticketId = String(body.thread_id || body.ticket_id || "");
  const traceId = String(body.trace_id || "");
  const message = String(body.message || "");
  const runtimeType = String(body.runtime_type || "sdk");
  const tenantSlug = String(body.tenant_slug || "");
  const instanceId = String(body.instance_id || "");

  if (!tenantId || !message) {
    return json(400, { error: "tenant_id and message are required" });
  }

  // Build composite session tenant (matches Python router line 391)
  const sessionTenant = assistantId
    ? `${tenantId}:${assistantId}:${ticketId}`
    : tenantId;

  try {
    const runtimeArn = await resolveRuntimeArn(runtimeType);
    const model = body.model ? String(body.model) : "";
    const sessionKey = String(body.session_key || "chat");
    const sessionId = deriveSessionId(
      assistantId,
      sessionTenant,
      runtimeType,
      model,
      sessionKey,
    );

    const payload: Record<string, unknown> = {
      sessionId: sessionTenant,
      message,
      ticket_id: ticketId,
      trace_id: traceId || undefined,
      use_memory: Boolean(body.use_memory),
      assistant_id: assistantId,
      workspace_tenant_id: tenantId,
      tenant_slug: tenantSlug,
      instance_id: instanceId,
    };
    if (body.model) payload.model = body.model;
    if (body.skills) payload.skills = body.skills;
    if (body.knowledge_bases) payload.knowledge_bases = body.knowledge_bases;
    if (body.mcp_servers) payload.mcp_servers = body.mcp_servers;
    if (body.mcp_base_url) payload.mcp_base_url = body.mcp_base_url;
    if (body.mcp_auth_secret) payload.mcp_auth_secret = body.mcp_auth_secret;
    if (body.gateway_url) payload.gateway_url = body.gateway_url;
    if (body.gateway_mcp_servers)
      payload.gateway_mcp_servers = body.gateway_mcp_servers;
    if (body.mcp_configs) payload.mcp_configs = body.mcp_configs;
    if (body.agent_name) payload.agent_name = body.agent_name;
    if (body.human_name) payload.human_name = body.human_name;
    if (body.workspace_bucket) payload.workspace_bucket = body.workspace_bucket;
    if (body.trigger_channel) payload.trigger_channel = body.trigger_channel;
    if (body.context_profile) payload.context_profile = body.context_profile;
    if (body.workspace_files) payload.workspace_files = body.workspace_files;
    // PRD-38: sub_agents removed — skills with mode:agent handle sub-agent creation in runtime
    if (body.guardrail_config) payload.guardrail_config = body.guardrail_config;
    if (body.hindsight_endpoint)
      payload.hindsight_endpoint = body.hindsight_endpoint;
    // Forward prior conversation history (loaded from Aurora `messages` by
    // chat-agent-invoke). Without this the Strands runtime falls back to a
    // single-turn invocation with no session memory.
    if (body.messages_history) payload.messages_history = body.messages_history;
    if (body.web_search_config) {
      payload.web_search_config = body.web_search_config;
    }
    if (body.send_email_config) {
      payload.send_email_config = body.send_email_config;
    }
    if (body.context_engine_enabled) {
      payload.context_engine_enabled = body.context_engine_enabled;
    }
    if (body.blocked_tools) payload.blocked_tools = body.blocked_tools;
    if (body.browser_automation_enabled) {
      payload.browser_automation_enabled = body.browser_automation_enabled;
    }

    console.log(
      `AgentCore payload keys: ${Object.keys(payload).join(", ")} hindsight=${payload.hindsight_endpoint ? "YES" : "NO"} instance_id=${payload.instance_id || "EMPTY"} runtime_arn=${runtimeArn.split("/").pop()}`,
    );
    const result = await invokeAgentCore(payload, runtimeArn, sessionId);

    return json(200, {
      tenant_id: tenantId,
      ticket_id: ticketId,
      trace_id: traceId || undefined,
      response: result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `AgentCore invocation failed tenant_id=${tenantId}:`,
      message,
    );
    return json(502, { error: message });
  }
}
