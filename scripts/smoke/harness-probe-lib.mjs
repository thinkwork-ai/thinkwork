import { randomUUID } from "node:crypto";

import { KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { EventStreamCodec } from "@smithy/eventstream-codec";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function requiredEnv(name, environment = process.env) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export async function mintHarnessAssertion(overrides = {}) {
  const region = overrides.region ?? requiredEnv("AWS_REGION");
  const now = Math.floor(Date.now() / 1000);
  const participantId =
    overrides.participantId ?? requiredEnv("HARNESS_PROBE_PARTICIPANT_ID");
  const claims = {
    iss: overrides.issuer ?? requiredEnv("ASSERTION_ISSUER"),
    aud: overrides.audience ?? requiredEnv("HARNESS_AUDIENCE"),
    sub: participantId,
    jti: randomUUID(),
    iat: now,
    exp: now + 300,
    tenant_id: overrides.tenantId ?? requiredEnv("HARNESS_PROBE_TENANT_ID"),
    space_id: overrides.spaceId ?? "harness-proof-space",
    agent_id: overrides.agentId ?? "harness-proof-agent",
    thread_id: overrides.threadId ?? `harness-proof-${randomUUID()}`,
    turn_id: overrides.turnId ?? `harness-proof-${randomUUID()}`,
    participant_id: participantId,
    session_generation: overrides.sessionGeneration ?? 1,
    purpose: "harness_invoke",
    scope: "harness:invoke",
  };
  const header = {
    alg: "RS256",
    kid: overrides.kid ?? requiredEnv("ASSERTION_KID"),
    typ: "JWT",
  };
  const signingInput = `${encodeJson(header)}.${encodeJson(claims)}`;
  const kms = new KMSClient({ region });
  const signed = await kms.send(
    new SignCommand({
      KeyId: overrides.keyId ?? requiredEnv("ASSERTION_KMS_KEY_ARN"),
      Message: Buffer.from(signingInput),
      MessageType: "RAW",
      SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256",
    }),
  );
  if (!signed.Signature?.byteLength) {
    throw new Error("KMS Sign returned no signature");
  }
  return `${signingInput}.${Buffer.from(signed.Signature).toString("base64url")}`;
}

function eventHeader(message, name) {
  return message.headers?.[name]?.value;
}

function collectUsage(value, result = { inputTokens: 0, outputTokens: 0 }) {
  if (!value || typeof value !== "object") return result;
  const record = value;
  const input =
    record.inputTokens ?? record.input_tokens ?? record.input ?? undefined;
  const output =
    record.outputTokens ?? record.output_tokens ?? record.output ?? undefined;
  if (Number.isFinite(Number(input))) result.inputTokens += Number(input);
  if (Number.isFinite(Number(output))) result.outputTokens += Number(output);
  for (const [key, child] of Object.entries(record)) {
    if (
      key !== "inputTokens" &&
      key !== "input_tokens" &&
      key !== "input" &&
      key !== "outputTokens" &&
      key !== "output_tokens" &&
      key !== "output"
    ) {
      collectUsage(child, result);
    }
  }
  return result;
}

export async function invokeHarness({
  token,
  sessionId,
  messages,
  harnessArn = requiredEnv("HARNESS_ARN"),
  qualifier = requiredEnv("HARNESS_QUALIFIER"),
  region = requiredEnv("AWS_REGION"),
}) {
  const url = new URL(
    `https://bedrock-agentcore.${region}.amazonaws.com/harnesses/invoke`,
  );
  url.searchParams.set("harnessArn", harnessArn);
  if (qualifier) url.searchParams.set("qualifier", qualifier);
  const startedAt = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-amzn-bedrock-agentcore-runtime-session-id": sessionId,
    },
    body: JSON.stringify({ messages, maxIterations: 8, timeoutSeconds: 180 }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok || !response.body) {
    const requestId =
      response.headers.get("x-amzn-requestid") ??
      response.headers.get("x-amz-request-id") ??
      "unknown";
    const responseText = (await response.text())
      .replace(/[\r\n\t]+/g, " ")
      .slice(0, 1_000);
    throw new Error(
      `Harness invocation returned HTTP ${response.status} request=${requestId} body=${responseText || "<empty>"}`,
    );
  }

  const codec = new EventStreamCodec(
    (bytes) => decoder.decode(bytes),
    (value) => encoder.encode(value),
  );
  let buffer = Buffer.alloc(0);
  let text = "";
  let stopReason;
  let usage = { inputTokens: 0, outputTokens: 0 };
  const eventShapes = new Set();

  for await (const chunk of response.body) {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    while (buffer.length >= 4) {
      const frameLength = buffer.readUInt32BE(0);
      if (frameLength < 16) throw new Error("Invalid Harness event frame");
      if (buffer.length < frameLength) break;
      const frame = buffer.subarray(0, frameLength);
      buffer = buffer.subarray(frameLength);
      const message = codec.decode(frame);
      const payloadText = decoder.decode(message.body);
      let event;
      try {
        event = JSON.parse(payloadText);
      } catch {
        continue;
      }
      if (eventHeader(message, ":message-type") === "exception") {
        throw new Error(
          `Harness stream ${eventHeader(message, ":exception-type") ?? "exception"}: ${event.message ?? "redacted service failure"}`,
        );
      }
      eventShapes.add(JSON.stringify(structuralShape(event)));
      const delta = event.delta ?? event.contentBlockDelta?.delta;
      if (typeof delta?.text === "string") text += delta.text;
      stopReason =
        event.stopReason ?? event.messageStop?.stopReason ?? stopReason;
      usage = collectUsage(event, usage);
    }
  }
  if (buffer.length !== 0) {
    throw new Error("Harness event stream ended with an incomplete frame");
  }
  return {
    text,
    stopReason,
    usage,
    eventShapes: [...eventShapes].map((value) => JSON.parse(value)),
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

function structuralShape(value, depth = 0) {
  if (depth > 4) return "nested";
  if (Array.isArray(value)) {
    return value.length > 0 ? [structuralShape(value[0], depth + 1)] : [];
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        structuralShape(child, depth + 1),
      ]),
    );
  }
  return typeof value;
}

export function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil((percentileValue / 100) * sorted.length) - 1];
}

export function safeError(error) {
  const name = error?.name ?? "Error";
  const status = error?.$metadata?.httpStatusCode;
  return status ? `${name}:${status}` : name;
}
