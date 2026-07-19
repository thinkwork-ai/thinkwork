/**
 * Exact-user AgentCore Gateway target for bounded Code Interpreter execution.
 *
 * The Harness never receives an interpreter id or reusable session handle.
 * This target re-authorizes the canonical running turn, selects the tenant's
 * internal-only interpreter, starts one short-lived session, executes one
 * bounded Python program, reads only declared export files, and stops the
 * session in a finally block.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { tenants } from "@thinkwork/database-pg/schema";
import {
  BedrockAgentCoreClient,
  InvokeCodeInterpreterCommand,
  StartCodeInterpreterSessionCommand,
  StopCodeInterpreterSessionCommand,
  type CodeInterpreterStreamOutput,
} from "@aws-sdk/client-bedrock-agentcore";
import {
  verifyProofProviderAccessToken,
  type AccessTokenClaims,
} from "@thinkwork/lambda/agentcore-proof-oauth-provider";
import {
  resolveHarnessCapabilityContext,
  type HarnessCapabilityClaims,
  type HarnessCapabilityContext,
} from "./harness-capability-mcp.js";
import {
  appendToolExecutionStarted,
  appendToolExecutionTerminal,
  drizzleToolExecutionLedgerStore,
  type ToolExecutionCorrelation,
  type ToolExecutionLedgerStore,
} from "../lib/harness/tool-execution-ledger.js";
import {
  HARNESS_SANDBOX_SESSION_TIMEOUT_SECONDS,
  HarnessSandboxPolicyError,
  sandboxSessionAlias,
  sandboxSessionName,
  sanitizeHarnessSandboxResult,
  validateHarnessSandboxRequest,
  type HarnessSandboxRequest,
  type HarnessSandboxResult,
} from "../lib/harness/sandbox-session-policy.js";

const EXECUTE_PATH = "/agentcore/capabilities/sandbox/execute";
const MAX_BODY_BYTES = 24 * 1024;

interface ExecuteBody {
  code?: unknown;
  language?: unknown;
  output_files?: unknown;
}

export interface HarnessSandboxExecutorResult {
  sessionAlias: string;
  result: HarnessSandboxResult;
}

export interface HarnessSandboxExecutorInput extends HarnessSandboxRequest {
  interpreterId: string;
  turnId: string;
  toolUseId: string;
}

export interface HarnessCodeInterpreterDeps {
  verifyAccessToken(token: string): HarnessCapabilityClaims;
  resolveCanonicalContext(
    claims: HarnessCapabilityClaims,
  ): Promise<HarnessCapabilityContext | null>;
  resolveInterpreterId(
    context: HarnessCapabilityContext,
  ): Promise<string | null>;
  execute(
    input: HarnessSandboxExecutorInput,
  ): Promise<HarnessSandboxExecutorResult>;
  ledgerStore: ToolExecutionLedgerStore;
  policyRevision: string;
  now(): number;
}

export function createHarnessCodeInterpreterHandler(
  deps: HarnessCodeInterpreterDeps,
) {
  return async function harnessCodeInterpreter(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const path = event.rawPath || event.requestContext.http.path;
    if (event.requestContext.http.method !== "POST" || path !== EXECUTE_PATH) {
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
    let body: ExecuteBody;
    try {
      body = JSON.parse(rawBody || "{}") as ExecuteBody;
    } catch {
      return response(400, { error: "invalid_json" });
    }
    if (Object.prototype.hasOwnProperty.call(body, "tenant_id")) {
      return response(400, { error: "identity_override_rejected" });
    }
    let request: HarnessSandboxRequest;
    try {
      request = validateHarnessSandboxRequest(body);
    } catch (error) {
      if (error instanceof HarnessSandboxPolicyError) {
        return response(400, { error: error.code });
      }
      throw error;
    }

    const context = await deps.resolveCanonicalContext(claims);
    if (!context) {
      return response(403, { error: "canonical_turn_not_authorized" });
    }
    const startedAt = deps.now();
    const correlation: ToolExecutionCorrelation = {
      tenantId: context.tenantId,
      threadId: context.threadId,
      turnId: context.turnId,
      principalType: "user",
      principalId: context.userId,
      toolUseId: event.requestContext.requestId,
      operation: "sandbox.execute_code",
      policyRevision: deps.policyRevision,
      idempotencyKey: event.requestContext.requestId,
      credentialOwnerAlias: "tenant:internal-only-interpreter",
    };
    await appendToolExecutionStarted(deps.ledgerStore, {
      ...correlation,
      input: {
        language: request.language,
        codeBytes: Buffer.byteLength(request.code, "utf8"),
        outputFileCount: request.outputFiles.length,
      },
      inputAllowPaths: ["language", "codeBytes", "outputFileCount"],
    });

    const finish = async (
      status: "completed" | "failed" | "uncertain",
      output: Record<string, unknown>,
      errorCode?: string,
    ) =>
      appendToolExecutionTerminal(deps.ledgerStore, {
        ...correlation,
        status,
        output,
        outputAllowPaths: [
          "sessionAlias",
          "exitCode",
          "fileCount",
          "truncated",
        ],
        ...(errorCode
          ? { error: { code: errorCode }, errorAllowPaths: ["code"] }
          : {}),
        durationMs: Math.max(0, deps.now() - startedAt),
      });

    try {
      const interpreterId = await deps.resolveInterpreterId(context);
      if (!interpreterId) {
        await finish("failed", { fileCount: 0 }, "sandbox_not_configured");
        return response(409, { error: "sandbox_not_configured" });
      }
      const execution = await deps.execute({
        ...request,
        interpreterId,
        turnId: context.turnId,
        toolUseId: event.requestContext.requestId,
      });
      const failed = execution.result.exitCode !== 0;
      await finish(
        failed ? "failed" : "completed",
        {
          sessionAlias: execution.sessionAlias,
          exitCode: execution.result.exitCode,
          fileCount: execution.result.files.length,
          truncated: execution.result.truncated,
        },
        failed ? "sandbox_execution_failed" : undefined,
      );
      return response(200, {
        is_error: failed,
        stdout: execution.result.stdout,
        stderr: execution.result.stderr,
        exit_code: execution.result.exitCode,
        execution_time_seconds: execution.result.executionTimeSeconds,
        files: execution.result.files,
        truncated: execution.result.truncated,
      });
    } catch (error) {
      console.error("[harness-code-interpreter] execution failed", {
        tenantId: context.tenantId,
        turnId: context.turnId,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      await finish(
        "uncertain",
        { fileCount: 0 },
        "sandbox_operation_failed",
      ).catch((ledgerError) =>
        console.error("[harness-code-interpreter] terminal evidence failed", {
          tenantId: context.tenantId,
          turnId: context.turnId,
          errorType:
            ledgerError instanceof Error ? ledgerError.name : "unknown",
        }),
      );
      return response(502, { error: "sandbox_operation_failed" });
    }
  };
}

async function resolveInternalInterpreterId(
  context: HarnessCapabilityContext,
): Promise<string | null> {
  const [tenant] = await getDb()
    .select({ interpreterId: tenants.sandbox_interpreter_internal_id })
    .from(tenants)
    .where(eq(tenants.id, context.tenantId))
    .limit(1);
  return tenant?.interpreterId?.trim() || null;
}

export async function executeAgentCoreSandbox(
  input: HarnessSandboxExecutorInput,
): Promise<HarnessSandboxExecutorResult> {
  const client = new BedrockAgentCoreClient({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  let sessionId: string | undefined;
  try {
    const started = await client.send(
      new StartCodeInterpreterSessionCommand({
        codeInterpreterIdentifier: input.interpreterId,
        name: sandboxSessionName(input.turnId, input.toolUseId),
        sessionTimeoutSeconds: HARNESS_SANDBOX_SESSION_TIMEOUT_SECONDS,
      }),
    );
    sessionId = started.sessionId;
    if (!sessionId) throw new Error("Code Interpreter returned no session id");

    const execution = await client.send(
      new InvokeCodeInterpreterCommand({
        codeInterpreterIdentifier: input.interpreterId,
        sessionId,
        name: "executeCode",
        arguments: {
          code: input.code,
          language: input.language,
          clearContext: false,
        } as never,
      }),
    );
    const parsed = await consumeStream(execution.stream);
    const files: Array<{ path: string; text: string }> = [];
    for (const path of input.outputFiles) {
      const read = await client.send(
        new InvokeCodeInterpreterCommand({
          codeInterpreterIdentifier: input.interpreterId,
          sessionId,
          name: "readFiles",
          arguments: { paths: [path] } as never,
        }),
      );
      const fileResult = await consumeStream(read.stream);
      files.push({ path, text: extractFileText(fileResult) });
    }
    return {
      sessionAlias: sandboxSessionAlias(sessionId),
      result: sanitizeHarnessSandboxResult({
        stdout: parsed.stdout,
        stderr: parsed.stderr,
        exitCode: parsed.exitCode,
        executionTimeSeconds: parsed.executionTimeSeconds,
        files,
        truncated: false,
      }),
    };
  } finally {
    if (sessionId) {
      await client.send(
        new StopCodeInterpreterSessionCommand({
          codeInterpreterIdentifier: input.interpreterId,
          sessionId,
        }),
      );
    }
  }
}

interface ParsedStream {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeSeconds: number | null;
  textBlocks: string[];
  files: unknown;
}

async function consumeStream(
  stream: AsyncIterable<CodeInterpreterStreamOutput> | undefined,
): Promise<ParsedStream> {
  const parsed: ParsedStream = {
    stdout: "",
    stderr: "",
    exitCode: 0,
    executionTimeSeconds: null,
    textBlocks: [],
    files: undefined,
  };
  if (!stream) return parsed;
  for await (const event of stream) {
    if (!("result" in event) || !event.result) continue;
    const result = event.result;
    if (result.isError) parsed.exitCode ||= 1;
    const structured = result.structuredContent as
      | {
          stdout?: string;
          stderr?: string;
          exitCode?: number;
          executionTime?: number;
          files?: unknown;
          content?: unknown;
        }
      | undefined;
    if (structured) {
      parsed.stdout += structured.stdout ?? "";
      parsed.stderr += structured.stderr ?? "";
      if (structured.exitCode !== undefined)
        parsed.exitCode = structured.exitCode;
      if (structured.executionTime !== undefined) {
        parsed.executionTimeSeconds = structured.executionTime;
      }
      parsed.files = structured.files ?? structured.content ?? parsed.files;
    }
    for (const block of result.content ?? []) {
      if (block.text !== undefined) parsed.textBlocks.push(block.text);
    }
  }
  return parsed;
}

function extractFileText(result: ParsedStream): string {
  if (Array.isArray(result.files) && result.files[0]) {
    const first = result.files[0] as { text?: unknown; content?: unknown };
    if (typeof first.text === "string") return first.text;
    if (typeof first.content === "string") return first.content;
  }
  if (result.textBlocks.length > 0) return result.textBlocks.join("");
  return result.stdout;
}

function hasCompleteTurnTuple(
  claims: HarnessCapabilityClaims,
): claims is HarnessCapabilityClaims {
  return Boolean(
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

const deployedHandler = createHarnessCodeInterpreterHandler({
  verifyAccessToken(token) {
    const issuer = requiredEnv("AGENTCORE_PROOF_OAUTH_ISSUER");
    return verifyProofProviderAccessToken(token, {
      issuer,
      audience: `${issuer.replace(/\/+$/, "")}/target`,
      secret: requiredEnv("AGENTCORE_PROOF_OAUTH_CLIENT_SECRET"),
      nowSeconds: Math.floor(Date.now() / 1_000),
    }) as AccessTokenClaims & HarnessCapabilityClaims;
  },
  resolveCanonicalContext: resolveHarnessCapabilityContext,
  resolveInterpreterId: resolveInternalInterpreterId,
  execute: executeAgentCoreSandbox,
  ledgerStore: drizzleToolExecutionLedgerStore(),
  policyRevision:
    process.env.AGENTCORE_GATEWAY_POLICY_REVISION?.trim() ||
    "sandbox-execute-v1",
  now: Date.now,
});

export const handler = deployedHandler;
