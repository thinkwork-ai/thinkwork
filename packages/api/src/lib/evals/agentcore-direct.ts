import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  resolveAgentRuntimeConfig,
  type AgentRuntimeConfig,
} from "../resolve-agent-runtime-config.js";
import { resolveRuntimeFunctionName } from "../resolve-runtime-function-name.js";

export const DEFAULT_EVAL_MODEL_ID = "moonshotai.kimi-k2.5";
export const DEFAULT_EVAL_AGENTCORE_INVOKE_TIMEOUT_MS = 210_000;

const lambdaClient = new LambdaClient({});

const APPSYNC_ENDPOINT = process.env.APPSYNC_ENDPOINT || "";
const APPSYNC_API_KEY = process.env.APPSYNC_API_KEY || "";
const THINKWORK_API_SECRET = process.env.THINKWORK_API_SECRET || "";
const WORKSPACE_BUCKET = process.env.WORKSPACE_BUCKET || "";
const THINKWORK_API_URL =
  process.env.THINKWORK_API_URL || process.env.MCP_BASE_URL || "";
const HINDSIGHT_ENDPOINT = process.env.HINDSIGHT_ENDPOINT || "";

export function evalModelId(model: string | null | undefined): string {
  return model?.trim() || DEFAULT_EVAL_MODEL_ID;
}

export function evalAgentCoreInvokeTimeoutMs(
  value = process.env.EVAL_AGENTCORE_INVOKE_TIMEOUT_MS,
): number {
  const parsed = Number(value ?? DEFAULT_EVAL_AGENTCORE_INVOKE_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_EVAL_AGENTCORE_INVOKE_TIMEOUT_MS;
  }
  return parsed;
}

export function extractAgentCoreResponseText(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return String(data);

  const obj = data as Record<string, any>;
  if (Array.isArray(obj.choices) && obj.choices[0]?.message?.content) {
    return obj.choices[0].message.content;
  }
  if (typeof obj.content === "string") return obj.content;
  if (typeof obj.response === "string") return obj.response;
  if (typeof obj.output === "string") return obj.output;
  if (typeof obj.text === "string") return obj.text;
  if (obj.response && typeof obj.response === "object") {
    return extractAgentCoreResponseText(obj.response);
  }

  return JSON.stringify(data);
}

export function buildEvalAgentCorePayload(input: {
  tenantId: string;
  agentId: string;
  sessionId: string;
  message: string;
  model: string | null | undefined;
  systemPrompt: string | null | undefined;
  runtimeConfig: AgentRuntimeConfig;
}): Record<string, unknown> {
  const runtimeConfig = input.runtimeConfig;

  return {
    tenant_id: input.tenantId,
    workspace_tenant_id: input.tenantId,
    assistant_id: input.agentId,
    thread_id: input.sessionId,
    trace_id: input.sessionId,
    message: input.message,
    messages_history: [],
    use_memory: false,
    tenant_slug: runtimeConfig.tenantSlug || undefined,
    instance_id: runtimeConfig.agentSlug || undefined,
    agent_name: runtimeConfig.agentName,
    system_prompt:
      input.systemPrompt || runtimeConfig.agentSystemPrompt || undefined,
    human_name: runtimeConfig.humanName || undefined,
    workspace_bucket: WORKSPACE_BUCKET || undefined,
    thinkwork_api_url: THINKWORK_API_URL || undefined,
    thinkwork_api_secret: THINKWORK_API_SECRET || undefined,
    appsync_endpoint: APPSYNC_ENDPOINT || undefined,
    appsync_api_key: APPSYNC_API_KEY || undefined,
    hindsight_endpoint: HINDSIGHT_ENDPOINT || undefined,
    web_search_config: runtimeConfig.webSearchConfig,
    send_email_config: runtimeConfig.sendEmailConfig || undefined,
    context_engine_enabled: runtimeConfig.contextEngineEnabled || undefined,
    context_engine_config: runtimeConfig.contextEngineConfig,
    runtime_type: runtimeConfig.runtimeType,
    model: evalModelId(input.model),
    skills:
      runtimeConfig.skillsConfig.length > 0
        ? runtimeConfig.skillsConfig
        : undefined,
    knowledge_bases: runtimeConfig.knowledgeBasesConfig,
    trigger_channel: "eval",
    guardrail_config: runtimeConfig.guardrailConfig || undefined,
    mcp_configs:
      runtimeConfig.mcpConfigs.length > 0
        ? runtimeConfig.mcpConfigs
        : undefined,
    blocked_tools:
      runtimeConfig.blockedTools.length > 0
        ? runtimeConfig.blockedTools
        : undefined,
    browser_automation_enabled:
      runtimeConfig.browserAutomationEnabled || undefined,
  };
}

export async function invokeAgentCoreForEval(input: {
  tenantId: string;
  agentId: string;
  sessionId: string;
  message: string;
  model: string | null | undefined;
  systemPrompt?: string | null;
}): Promise<{ output: string; durationMs: number }> {
  const runtimeConfig = await resolveAgentRuntimeConfig({
    tenantId: input.tenantId,
    agentId: input.agentId,
    thinkworkApiUrl: THINKWORK_API_URL,
    thinkworkApiSecret: THINKWORK_API_SECRET,
    appsyncApiKey: APPSYNC_API_KEY,
    logPrefix: "[eval-worker]",
  });
  const agentcoreFunctionName = resolveRuntimeFunctionName(
    runtimeConfig.runtimeType,
  );
  const invokePayload = buildEvalAgentCorePayload({
    ...input,
    systemPrompt: input.systemPrompt ?? null,
    runtimeConfig,
  });
  const lambdaEventPayload = JSON.stringify({
    requestContext: { http: { method: "POST", path: "/invocations" } },
    rawPath: "/invocations",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(invokePayload),
    isBase64Encoded: false,
  });

  const startedAt = Date.now();
  const timeoutMs = evalAgentCoreInvokeTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let invokeRes;
  try {
    invokeRes = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: agentcoreFunctionName,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(lambdaEventPayload),
      }),
      { abortSignal: controller.signal },
    );
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(
        `AgentCore eval invocation timed out after ${timeoutMs}ms`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  const rawPayload = invokeRes.Payload
    ? new TextDecoder().decode(invokeRes.Payload)
    : "{}";

  if (invokeRes.FunctionError) {
    throw new Error(
      `AgentCore Lambda ${invokeRes.FunctionError}: ${rawPayload.slice(0, 500)}`,
    );
  }

  const adapterResp = JSON.parse(rawPayload) as Record<string, unknown>;
  const adapterStatus = (adapterResp.statusCode as number) || 200;
  const adapterBodyStr = (adapterResp.body as string) || rawPayload;
  if (adapterStatus < 200 || adapterStatus >= 300) {
    throw new Error(
      `AgentCore ${adapterStatus}: ${adapterBodyStr.slice(0, 500)}`,
    );
  }

  const invokeResult = JSON.parse(adapterBodyStr) as Record<string, unknown>;
  const responseData = invokeResult.response || invokeResult;
  const output = extractAgentCoreResponseText(responseData);
  if (!output || output === "{}") {
    throw new Error("AgentCore returned an empty eval response");
  }

  return { output, durationMs: Date.now() - startedAt };
}
