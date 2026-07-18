/**
 * AgentCore Gateway target for ThinkWork's dynamic MCP capability surface.
 *
 * AgentCore Identity authenticates the exact participant to this target. The
 * target then re-reads the canonical running turn before it resolves any MCP
 * configuration or per-user credential. Connector tokens never enter Harness,
 * Gateway configuration, model prompts, or the response envelope.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  messages,
  threads,
  threadTurns,
  users,
} from "@thinkwork/database-pg/schema";
import {
  verifyProofProviderAccessToken,
  type AccessTokenClaims,
} from "@thinkwork/lambda/agentcore-proof-oauth-provider";
import { buildMcpConfigs, type McpServerConfig } from "../lib/mcp-configs.js";
import {
  mcpCallTool,
  mcpListTools,
  type McpToolDefinition,
} from "../lib/mcp-client-call.js";
import type { CapabilitiesManifest } from "../lib/capabilities/manifest-compile.js";
import {
  appendToolExecutionStarted,
  appendToolExecutionTerminal,
  drizzleToolExecutionLedgerStore,
  type ToolExecutionCorrelation,
  type ToolExecutionLedgerStore,
} from "../lib/harness/tool-execution-ledger.js";

const LIST_PATH = "/agentcore/capabilities/mcp/tools/list";
const CALL_PATH = "/agentcore/capabilities/mcp/tools/call";
const MAX_BODY_BYTES = 256 * 1024;
const MAX_TOOLS = 200;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,127}$/;
const ACCEPTED_RUNTIME_TYPES = new Set(["agentcore", "harness"]);

export interface HarnessCapabilityClaims {
  sub: string;
  participant_id: string;
  tenant_id: string;
  space_id?: string;
  agent_id: string;
  thread_id: string;
  turn_id: string;
  session_generation: number;
}

export interface HarnessCapabilityContext {
  tenantId: string;
  userId: string;
  agentId: string;
  threadId: string;
  turnId: string;
  spaceId: string | null;
}

interface ListBody {
  tenant_id: string;
  connector: string;
}

interface CallBody extends ListBody {
  tool: string;
  arguments: Record<string, unknown>;
}

export interface HarnessCapabilityMcpDeps {
  verifyAccessToken(token: string): HarnessCapabilityClaims;
  resolveCanonicalContext(
    claims: HarnessCapabilityClaims,
  ): Promise<HarnessCapabilityContext | null>;
  resolveMcpConfigs(
    context: HarnessCapabilityContext,
    tokenMode: "probe" | "resolve",
  ): Promise<McpServerConfig[]>;
  listTools(config: McpServerConfig): Promise<McpToolDefinition[]>;
  callTool(
    config: McpServerConfig,
    tool: string,
    args: Record<string, unknown>,
    context: HarnessCapabilityContext,
  ): Promise<unknown>;
  ledgerStore: ToolExecutionLedgerStore;
  policyRevision: string;
  now(): number;
}

export function createHarnessCapabilityMcpHandler(
  deps: HarnessCapabilityMcpDeps,
) {
  return async function harnessCapabilityMcp(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const path = event.rawPath || event.requestContext.http.path;
    if (
      event.requestContext.http.method !== "POST" ||
      (path !== LIST_PATH && path !== CALL_PATH)
    ) {
      return response(404, { error: "not_found" });
    }
    if (
      event.headers["x-thinkwork-user-id"] ||
      event.headers["x-thinkwork-tenant-id"] ||
      event.headers["x-thinkwork-agent-id"] ||
      event.headers["x-thinkwork-turn-id"]
    ) {
      return response(400, { error: "identity_override_rejected" });
    }
    const authorization =
      event.headers.authorization ?? event.headers.Authorization ?? "";
    if (!authorization.startsWith("Bearer ")) {
      return response(401, { error: "exact_user_token_required" });
    }

    let claims: HarnessCapabilityClaims;
    try {
      claims = deps.verifyAccessToken(authorization.slice(7));
    } catch {
      return response(401, { error: "exact_user_token_invalid" });
    }
    if (!hasCompleteTurnTuple(claims)) {
      return response(401, { error: "turn_bound_token_required" });
    }

    const rawBody = decodeBody(event);
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      return response(413, { error: "request_too_large" });
    }
    let body: ListBody | CallBody;
    try {
      body = JSON.parse(rawBody || "{}") as ListBody | CallBody;
    } catch {
      return response(400, { error: "invalid_json" });
    }
    if (!isIdentifier(body.connector)) {
      return response(400, { error: "invalid_connector" });
    }
    if (body.tenant_id !== claims.tenant_id) {
      return response(403, { error: "tenant_context_mismatch" });
    }
    if (
      path === CALL_PATH &&
      (!isIdentifier((body as CallBody).tool) ||
        !isRecord((body as CallBody).arguments))
    ) {
      return response(400, { error: "invalid_tool_call" });
    }

    // Discovery is advisory. Both list and call re-read the canonical turn and
    // current capability projection; no descriptor from a previous list call
    // carries authorization into this request.
    const context = await deps.resolveCanonicalContext(claims);
    if (!context) {
      return response(403, { error: "canonical_turn_not_authorized" });
    }

    const isList = path === LIST_PATH;
    const call = isList ? null : (body as CallBody);
    const startedAt = deps.now();
    const correlation: ToolExecutionCorrelation = {
      tenantId: context.tenantId,
      threadId: context.threadId,
      turnId: context.turnId,
      principalType: "user",
      principalId: context.userId,
      toolUseId: event.requestContext.requestId,
      operation: isList ? "mcp.tools.list" : "mcp.tools.call",
      policyRevision: deps.policyRevision,
      idempotencyKey: event.requestContext.requestId,
    };
    await appendToolExecutionStarted(deps.ledgerStore, {
      ...correlation,
      input: {
        connector: body.connector,
        ...(call
          ? {
              tool: call.tool,
              argumentKeys: Object.keys(call.arguments).sort(),
            }
          : {}),
      },
      inputAllowPaths: call
        ? ["connector", "tool", "argumentKeys[]"]
        : ["connector"],
    });

    const finish = async (
      status: "completed" | "failed" | "uncertain",
      output: Record<string, unknown>,
      outputAllowPaths: readonly string[],
      errorCode?: string,
    ) =>
      appendToolExecutionTerminal(deps.ledgerStore, {
        ...correlation,
        status,
        output,
        outputAllowPaths,
        ...(errorCode
          ? { error: { code: errorCode }, errorAllowPaths: ["code"] }
          : {}),
        durationMs: Math.max(0, deps.now() - startedAt),
      });

    try {
      // Resolve authorization metadata without touching Secrets Manager or a
      // provider token endpoint. An unassigned connector/tool must be denied
      // before its credential is materialized in this process.
      const probeConfigs = await deps.resolveMcpConfigs(context, "probe");
      const probeConfig = selectConnector(probeConfigs, body.connector);
      if (!probeConfig) {
        await finish(
          "failed",
          { connector: body.connector },
          ["connector"],
          "connector_not_available",
        );
        return response(404, { error: "connector_not_available" });
      }
      if (call && !isToolAssigned(probeConfig, call.tool)) {
        await finish(
          "failed",
          { connector: probeConfig.name, tool: call.tool },
          ["connector", "tool"],
          "tool_not_available",
        );
        return response(404, { error: "tool_not_available" });
      }

      const configs = await deps.resolveMcpConfigs(context, "resolve");
      const config = selectConnector(configs, body.connector);
      if (!config) {
        await finish(
          "failed",
          { connector: body.connector },
          ["connector"],
          "connector_credential_unavailable",
        );
        return response(404, { error: "connector_not_available" });
      }
      if (isList) {
        const tools = (await deps.listTools(config))
          .filter((tool) => isToolAssigned(probeConfig, tool.name))
          .slice(0, MAX_TOOLS)
          .map((tool) => ({
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            inputSchema: tool.inputSchema ?? { type: "object" },
          }));
        await finish(
          "completed",
          { connector: config.name, toolCount: tools.length },
          ["connector", "toolCount"],
        );
        return response(200, { connector: config.name, tools });
      }
      if (!call) throw new Error("validated call body is missing");
      const currentTools = await deps.listTools(config);
      const exposedByServer = currentTools.some(
        (definition) => definition.name === call.tool,
      );
      const exposedByAssignment = isToolAssigned(probeConfig, call.tool);
      if (!exposedByServer || !exposedByAssignment) {
        await finish(
          "failed",
          { connector: config.name, tool: call.tool },
          ["connector", "tool"],
          "tool_not_available",
        );
        return response(404, { error: "tool_not_available" });
      }
      const result = await deps.callTool(
        config,
        call.tool,
        call.arguments,
        context,
      );
      const resultShape = summarizeToolResult(config.name, call.tool, result);
      const providerReportedError = resultShape.isError === true;
      await finish(
        providerReportedError ? "failed" : "completed",
        resultShape,
        ["connector", "tool", "isError", "contentBlocks"],
        providerReportedError ? "provider_tool_error" : undefined,
      );
      return response(200, {
        connector: config.name,
        tool: call.tool,
        result,
      });
    } catch (error) {
      // Provider and credential errors can echo secret-bearing headers or
      // payloads. Keep the public envelope structured and deliberately terse.
      console.error("[harness-capability-mcp] provider operation failed", {
        tenantId: context.tenantId,
        turnId: context.turnId,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      await finish(
        call ? "uncertain" : "failed",
        { connector: body.connector, ...(call ? { tool: call.tool } : {}) },
        call ? ["connector", "tool"] : ["connector"],
        "connector_operation_failed",
      ).catch((ledgerError) =>
        console.error("[harness-capability-mcp] terminal evidence failed", {
          tenantId: context.tenantId,
          turnId: context.turnId,
          errorType:
            ledgerError instanceof Error ? ledgerError.name : "unknown",
        }),
      );
      return response(502, { error: "connector_operation_failed" });
    }
  };
}

export async function resolveHarnessCapabilityContext(
  claims: HarnessCapabilityClaims,
): Promise<HarnessCapabilityContext | null> {
  const db = getDb();
  const [row] = await db
    .select({
      tenantId: threadTurns.tenant_id,
      turnId: threadTurns.id,
      turnStatus: threadTurns.status,
      retryAttempt: threadTurns.retry_attempt,
      runtimeType: threadTurns.runtime_type,
      turnAgentId: threadTurns.agent_id,
      threadId: threadTurns.thread_id,
      threadAgentId: threads.agent_id,
      spaceId: threads.space_id,
      triggeringMessageId: threadTurns.triggering_message_id,
      senderId: messages.sender_id,
      senderType: messages.sender_type,
      userId: users.id,
      userTenantId: users.tenant_id,
      agentId: agents.id,
      agentTenantId: agents.tenant_id,
    })
    .from(threadTurns)
    .innerJoin(
      threads,
      and(
        eq(threads.id, threadTurns.thread_id),
        eq(threads.tenant_id, threadTurns.tenant_id),
      ),
    )
    .innerJoin(
      messages,
      and(
        eq(messages.id, threadTurns.triggering_message_id),
        eq(messages.thread_id, threadTurns.thread_id),
        eq(messages.tenant_id, threadTurns.tenant_id),
      ),
    )
    .innerJoin(users, eq(users.id, messages.sender_id))
    .innerJoin(
      agents,
      and(
        eq(agents.id, threadTurns.agent_id),
        eq(agents.tenant_id, threadTurns.tenant_id),
      ),
    )
    .where(
      and(
        eq(threadTurns.id, claims.turn_id),
        eq(threadTurns.tenant_id, claims.tenant_id),
      ),
    )
    .limit(1);

  if (
    !row ||
    row.turnStatus !== "running" ||
    (row.retryAttempt ?? 0) + 1 !== claims.session_generation ||
    !ACCEPTED_RUNTIME_TYPES.has(row.runtimeType ?? "") ||
    row.tenantId !== claims.tenant_id ||
    row.turnId !== claims.turn_id ||
    row.threadId !== claims.thread_id ||
    row.turnAgentId !== claims.agent_id ||
    row.threadAgentId !== claims.agent_id ||
    row.triggeringMessageId == null ||
    row.senderId !== claims.participant_id ||
    row.senderId !== claims.sub ||
    (row.senderType !== "human" && row.senderType !== "user") ||
    row.userId !== claims.sub ||
    row.userTenantId !== claims.tenant_id ||
    row.agentId !== claims.agent_id ||
    row.agentTenantId !== claims.tenant_id ||
    (claims.space_id !== undefined && row.spaceId !== claims.space_id)
  ) {
    return null;
  }
  return {
    tenantId: row.tenantId,
    userId: row.userId,
    agentId: row.agentId,
    threadId: row.threadId,
    turnId: row.turnId,
    spaceId: row.spaceId,
  };
}

async function resolveMcpConfigsForHarness(
  context: HarnessCapabilityContext,
  tokenMode: "probe" | "resolve",
): Promise<McpServerConfig[]> {
  const db = getDb();
  const [agent] = await db
    .select({
      capabilityFolderDispatch: agents.capability_folder_dispatch,
      runtimeConfig: agents.runtime_config,
    })
    .from(agents)
    .where(
      and(
        eq(agents.id, context.agentId),
        eq(agents.tenant_id, context.tenantId),
      ),
    )
    .limit(1);
  if (!agent) return [];

  let folderCapabilities: { manifest: CapabilitiesManifest | null } | undefined;
  if (agent.capabilityFolderDispatch === true) {
    if (!context.spaceId) return [];
    const { renderWorkspaceTuple } = await import(
      "../lib/workspace-renderer/compose-tuple.js"
    );
    const rendered = await renderWorkspaceTuple(
      {
        tenantId: context.tenantId,
        agentId: context.agentId,
        spaceId: context.spaceId,
        userId: context.userId,
      },
      { persist: false },
    );
    folderCapabilities = {
      manifest: rendered.capabilities?.manifest ?? null,
    };
  }

  return buildMcpConfigs(
    context.agentId,
    {
      requesterUserId: context.userId,
      humanPairId: context.userId,
    },
    "[harness-capability-mcp]",
    {
      ...(folderCapabilities ? { folderCapabilities } : {}),
      ...(tokenMode === "probe" ? { tokenMode: "probe" as const } : {}),
    },
  );
}

function targetFor(config: McpServerConfig) {
  return {
    url: config.url,
    token: config.auth?.type === "bearer" ? config.auth.token : undefined,
    headers:
      config.auth && "headers" in config.auth ? config.auth.headers : undefined,
    name: config.name,
  };
}

const deployedHandler = createHarnessCapabilityMcpHandler({
  verifyAccessToken(token) {
    return verifyProofProviderAccessToken(token, {
      issuer: requiredEnv("AGENTCORE_PROOF_OAUTH_ISSUER"),
      audience: `${requiredEnv("AGENTCORE_PROOF_OAUTH_ISSUER").replace(/\/+$/, "")}/target`,
      secret: requiredEnv("AGENTCORE_PROOF_OAUTH_CLIENT_SECRET"),
      nowSeconds: Math.floor(Date.now() / 1000),
    }) as AccessTokenClaims & HarnessCapabilityClaims;
  },
  resolveCanonicalContext: resolveHarnessCapabilityContext,
  resolveMcpConfigs: resolveMcpConfigsForHarness,
  listTools: async (config) => mcpListTools(targetFor(config)),
  callTool: async (config, tool, args) =>
    config.recordLinkHints || config.resultTransforms
      ? mcpCallTool(targetFor(config), tool, args, {
          recordLinkHints: config.recordLinkHints,
          resultTransforms: config.resultTransforms,
        })
      : mcpCallTool(targetFor(config), tool, args),
  ledgerStore: drizzleToolExecutionLedgerStore(),
  policyRevision:
    process.env.AGENTCORE_GATEWAY_POLICY_REVISION?.trim() || "mcp-list-call-v1",
  now: Date.now,
});

export const handler = deployedHandler;

function hasCompleteTurnTuple(
  claims: HarnessCapabilityClaims,
): claims is HarnessCapabilityClaims {
  return Boolean(
    claims &&
      claims.sub &&
      claims.participant_id &&
      claims.sub === claims.participant_id &&
      claims.tenant_id &&
      claims.agent_id &&
      claims.thread_id &&
      claims.turn_id &&
      Number.isInteger(claims.session_generation) &&
      claims.session_generation > 0,
  );
}

function selectConnector(
  configs: McpServerConfig[],
  requested: string,
): McpServerConfig | undefined {
  const normalized = requested.toLowerCase();
  return configs.find((config) => config.name.toLowerCase() === normalized);
}

function isToolAssigned(config: McpServerConfig, toolName: string): boolean {
  return !config.tools?.length || config.tools.includes(toolName);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function summarizeToolResult(
  connector: string,
  tool: string,
  result: unknown,
): Record<string, unknown> {
  if (!isRecord(result)) {
    return { connector, tool, isError: false, contentBlocks: 0 };
  }
  return {
    connector,
    tool,
    isError: result.isError === true,
    contentBlocks: Array.isArray(result.content) ? result.content.length : 0,
  };
}

function decodeBody(event: APIGatewayProxyEventV2): string {
  const body = event.body ?? "";
  return event.isBase64Encoded
    ? Buffer.from(body, "base64").toString("utf8")
    : body;
}

function response(
  statusCode: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      pragma: "no-cache",
    },
    body: JSON.stringify(body),
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
