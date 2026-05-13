import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type { RunbookAgentCoreInvocation } from "./api-client.js";

const DEFAULT_AGENTCORE_REQUEST_TIMEOUT_MS = 8 * 60 * 1000;
const DEFAULT_AGENTCORE_INIT_RETRY_ATTEMPTS = 3;
const DEFAULT_AGENTCORE_INIT_RETRY_DELAY_MS = 10_000;

export async function invokeRunbookAgentCoreStep(
  invocation: RunbookAgentCoreInvocation,
) {
  const client = new BedrockAgentCoreClient({
    requestHandler: {
      requestTimeout: positiveNumberFromEnv(
        "RUNBOOK_AGENTCORE_REQUEST_TIMEOUT_MS",
        DEFAULT_AGENTCORE_REQUEST_TIMEOUT_MS,
      ),
    },
  });
  const startedAt = Date.now();
  const response = await sendWithInitializationRetry(client, invocation);
  const text = await responseToText(response.response);
  const parsed = parseJson(text);
  const responseData =
    isRecord(parsed) && "response" in parsed ? parsed.response : parsed;
  return {
    ok: true as const,
    responseText: extractResponseText(responseData),
    model: modelFromPayload(invocation.payload),
    usage: isRecord(parsed) ? parsed.usage : undefined,
    durationMs: Date.now() - startedAt,
  };
}

async function sendWithInitializationRetry(
  client: BedrockAgentCoreClient,
  invocation: RunbookAgentCoreInvocation,
) {
  const attempts = Math.max(
    1,
    Math.trunc(
      positiveNumberFromEnv(
        "RUNBOOK_AGENTCORE_INIT_RETRY_ATTEMPTS",
        DEFAULT_AGENTCORE_INIT_RETRY_ATTEMPTS,
      ),
    ),
  );
  const delayMs = positiveNumberFromEnv(
    "RUNBOOK_AGENTCORE_INIT_RETRY_DELAY_MS",
    DEFAULT_AGENTCORE_INIT_RETRY_DELAY_MS,
  );
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await client.send(
        new InvokeAgentRuntimeCommand({
          agentRuntimeArn: invocation.runtimeArn,
          runtimeSessionId: invocation.runtimeSessionId,
          payload: JSON.stringify(invocation.payload),
        }),
      );
    } catch (error) {
      lastError = error;
      if (!isRuntimeInitializationTimeout(error) || attempt === attempts) {
        throw error;
      }
      console.warn(
        `[runbook-agentcore] AgentCore runtime initialization timed out; retrying attempt ${attempt + 1}/${attempts}`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function responseToText(response: unknown) {
  if (
    isRecord(response) &&
    typeof response.transformToByteArray === "function"
  ) {
    const bytes = await response.transformToByteArray();
    return new TextDecoder().decode(bytes);
  }
  if (response instanceof Uint8Array) return new TextDecoder().decode(response);
  if (typeof response === "string") return response;
  return JSON.stringify(response ?? {});
}

function parseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractResponseText(data: unknown): string {
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
    return extractResponseText(obj.response);
  }
  return JSON.stringify(data);
}

function modelFromPayload(payload: Record<string, unknown>) {
  return typeof payload.model === "string" ? payload.model : undefined;
}

function positiveNumberFromEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isRuntimeInitializationTimeout(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : isRecord(error) && typeof error.message === "string"
        ? error.message
        : String(error);
  return message.includes("Runtime initialization time exceeded");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
