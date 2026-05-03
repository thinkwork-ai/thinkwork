import type { AgentTool } from "@mariozechner/pi-agent-core";
import {
  BedrockAgentCoreClient,
  type CodeInterpreterStreamOutput,
  InvokeCodeInterpreterCommand,
  StartCodeInterpreterSessionCommand,
  StopCodeInterpreterSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { Type } from "typebox";
import { optionalString, type PiInvocationPayload } from "./types.js";

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const record = block as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (typeof record.uri === "string") return record.uri;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function paramsRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === "object"
    ? (params as Record<string, unknown>)
    : {};
}

function shapeException(record: Record<string, unknown>) {
  const [kind, value] = Object.entries(record).find(
    ([key]) => key !== "$metadata",
  ) ?? ["unknown", {}];
  const message =
    value && typeof value === "object" && "message" in value
      ? String((value as { message?: unknown }).message ?? "")
      : JSON.stringify(value);
  return { ok: false, stdout: "", stderr: `${kind}: ${message}`, error: kind };
}

async function consumeStream(
  stream: AsyncIterable<CodeInterpreterStreamOutput> | undefined,
) {
  if (!stream) {
    return {
      ok: false,
      stdout: "",
      stderr: "No code interpreter stream returned",
    };
  }

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const raw: unknown[] = [];
  let exitCode: number | undefined;
  let isError = false;
  let taskStatus: unknown;
  let executionTime: unknown;

  for await (const event of stream) {
    raw.push(event);
    if (event.result) {
      const structured = event.result.structuredContent ?? {};
      if (typeof structured.stdout === "string")
        stdoutChunks.push(structured.stdout);
      else {
        const text = textFromContent(event.result.content);
        if (text) stdoutChunks.push(text);
      }
      if (typeof structured.stderr === "string" && structured.stderr) {
        stderrChunks.push(structured.stderr);
      }
      if (typeof structured.exitCode === "number")
        exitCode = structured.exitCode;
      taskStatus = structured.taskStatus ?? taskStatus;
      executionTime = structured.executionTime ?? executionTime;
      isError = isError || Boolean(event.result.isError);
      continue;
    }

    const exception = shapeException(
      event as unknown as Record<string, unknown>,
    );
    stderrChunks.push(exception.stderr);
    isError = true;
  }

  return {
    ok: !isError && (exitCode === undefined || exitCode === 0),
    stdout: stdoutChunks.join("\n"),
    stderr: stderrChunks.join("\n"),
    exit_code: exitCode,
    task_status: taskStatus,
    execution_time: executionTime,
    raw,
  };
}

export function buildExecuteCodeTool(
  payload: PiInvocationPayload,
  cleanup: Array<() => Promise<void>>,
): AgentTool<any> | null {
  const interpreterId = optionalString(payload.sandbox_interpreter_id);
  if (!interpreterId) {
    const sandboxStatus = optionalString(payload.sandbox_status);
    if (!sandboxStatus || sandboxStatus === "not-requested") return null;
    return {
      name: "execute_code",
      label: "Execute Code",
      description:
        "Run Python code in the tenant's AgentCore Code Interpreter sandbox. Use for calculations, data analysis, and code-backed verification.",
      parameters: Type.Object({
        code: Type.String({ description: "Python code to execute." }),
        language: Type.Optional(
          Type.String({ description: "Language; only python is supported." }),
        ),
        clear_context: Type.Optional(Type.Boolean()),
      }),
      executionMode: "sequential",
      execute: async () => ({
        content: [
          {
            type: "text",
            text: `Code sandbox is unavailable: ${optionalString(payload.sandbox_reason) ?? sandboxStatus}.`,
          },
        ],
        details: {
          ok: false,
          error: "SandboxUnavailable",
          sandbox_status: sandboxStatus,
          sandbox_reason: optionalString(payload.sandbox_reason),
        },
      }),
    };
  }

  const client = new BedrockAgentCoreClient({});
  let sessionId: string | undefined;

  cleanup.push(async () => {
    if (!sessionId) return;
    await client
      .send(
        new StopCodeInterpreterSessionCommand({
          codeInterpreterIdentifier: interpreterId,
          sessionId,
        }),
      )
      .catch((err: unknown) => {
        console.warn("[agentcore-flue] execute_code stop session failed", err);
      });
    sessionId = undefined;
  });

  async function ensureSession(traceId?: string): Promise<string> {
    if (sessionId) return sessionId;
    const response = await client.send(
      new StartCodeInterpreterSessionCommand({
        codeInterpreterIdentifier: interpreterId,
        name: `pi-${Date.now()}`,
        sessionTimeoutSeconds: 300,
        traceId,
      }),
    );
    sessionId = response.sessionId;
    if (!sessionId)
      throw new Error("Code interpreter did not return sessionId");
    return sessionId;
  }

  return {
    name: "execute_code",
    label: "Execute Code",
    description:
      "Run Python code in the tenant's AgentCore Code Interpreter sandbox. Use for calculations, data analysis, and code-backed verification.",
    parameters: Type.Object({
      code: Type.String({ description: "Python code to execute." }),
      language: Type.Optional(
        Type.String({ description: "Language; only python is supported." }),
      ),
      clear_context: Type.Optional(Type.Boolean()),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const input = paramsRecord(params);
      const code = String(input.code || "").trim();
      if (!code) throw new Error("execute_code requires code");
      const language = String(input.language || "python").toLowerCase();
      if (language !== "python")
        throw new Error("execute_code currently supports python only");
      const sid = await ensureSession(optionalString(payload.trace_id));
      const response = await client.send(
        new InvokeCodeInterpreterCommand({
          codeInterpreterIdentifier: interpreterId,
          sessionId: sid,
          traceId: optionalString(payload.trace_id),
          name: "executeCode",
          arguments: {
            code,
            language: "python",
            clearContext: input.clear_context === true,
          },
        }),
      );
      const result = await consumeStream(response.stream);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: {
          interpreter_id: interpreterId,
          session_id: sid,
          ...result,
        },
      };
    },
  };
}
