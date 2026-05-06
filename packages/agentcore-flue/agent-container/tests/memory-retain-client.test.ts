/**
 * Vitest coverage for the per-turn auto-retain client.
 *
 * Pattern follows `hindsight.test.ts`: inject the AWS client (here a
 * minimal `LambdaClient` stub) so the test surface stays explicit and
 * parallel-safe. Avoids module-private mutable state.
 */

import { describe, expect, it, vi } from "vitest";
import {
  InvokeCommand,
  type InvokeCommandInput,
  type LambdaClient,
} from "@aws-sdk/client-lambda";

import {
  buildMemoryRetainRequest,
  buildRetainTranscript,
  retainConversation,
  type RetainPayloadInput,
} from "../src/runtime/tools/memory-retain-client.js";
import type {
  IdentitySnapshot,
  RuntimeEnvSnapshot,
} from "../src/handler-context.js";

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

interface SendCall {
  command: InvokeCommand;
  input: InvokeCommandInput;
  decodedPayload: unknown;
}

function makeStubLambdaClient(opts: {
  fail?: Error;
  recorder?: SendCall[];
}): LambdaClient {
  const send = vi.fn(async (command: InvokeCommand) => {
    if (opts.fail) throw opts.fail;
    if (opts.recorder) {
      const input = command.input as InvokeCommandInput;
      const payloadBytes = input.Payload;
      let decoded: unknown = null;
      if (payloadBytes instanceof Uint8Array) {
        decoded = JSON.parse(new TextDecoder().decode(payloadBytes));
      }
      opts.recorder.push({ command, input, decodedPayload: decoded });
    }
    return {} as never;
  });
  return { send } as unknown as LambdaClient;
}

function makeIdentity(
  overrides: Partial<IdentitySnapshot> = {},
): IdentitySnapshot {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    agentId: "agent-1",
    threadId: "thread-1",
    tenantSlug: "ts",
    agentSlug: "as",
    traceId: "tr",
    ...overrides,
  };
}

function makeEnv(
  overrides: Partial<RuntimeEnvSnapshot> = {},
): RuntimeEnvSnapshot {
  return {
    awsRegion: "us-east-1",
    agentCoreMemoryId: "",
    hindsightEndpoint: "",
    memoryEngine: "hindsight",
    memoryRetainFnName: "thinkwork-dev-api-memory-retain",
    dbClusterArn: "",
    dbSecretArn: "",
    dbName: "thinkwork",
    workspaceBucket: "",
    workspaceDir: "/tmp/workspace",
    gitSha: "test",
    ...overrides,
  };
}

const BASE_PAYLOAD: RetainPayloadInput = {
  use_memory: true,
  message: "what's my favorite color?",
  messages_history: [
    { role: "user", content: "my favorite color is teal" },
    { role: "assistant", content: "Noted! I'll remember that." },
  ],
};

// ---------------------------------------------------------------------------
// buildRetainTranscript
// ---------------------------------------------------------------------------

describe("buildRetainTranscript", () => {
  it("returns history + user message + assistant response in order", () => {
    const transcript = buildRetainTranscript(BASE_PAYLOAD, "Your favorite is teal.");
    expect(transcript).toEqual([
      { role: "user", content: "my favorite color is teal" },
      { role: "assistant", content: "Noted! I'll remember that." },
      { role: "user", content: "what's my favorite color?" },
      { role: "assistant", content: "Your favorite is teal." },
    ]);
  });

  it("filters history entries with non-string content", () => {
    const transcript = buildRetainTranscript(
      {
        messages_history: [
          { role: "user", content: "valid" },
          { role: "user", content: { nested: "object" } },
          { role: "user", content: null },
          { role: "assistant", content: 42 },
          { role: "assistant", content: "also valid" },
        ],
        message: "tail user",
      },
      "tail assistant",
    );
    expect(transcript).toEqual([
      { role: "user", content: "valid" },
      { role: "assistant", content: "also valid" },
      { role: "user", content: "tail user" },
      { role: "assistant", content: "tail assistant" },
    ]);
  });

  it("filters history entries with non-user/assistant roles", () => {
    const transcript = buildRetainTranscript(
      {
        messages_history: [
          { role: "system", content: "system prompt" },
          { role: "tool", content: "tool result" },
          { role: "user", content: "real user" },
        ],
        message: "",
      },
      "",
    );
    expect(transcript).toEqual([{ role: "user", content: "real user" }]);
  });

  it("skips empty / whitespace-only history content", () => {
    const transcript = buildRetainTranscript(
      {
        messages_history: [
          { role: "user", content: "" },
          { role: "user", content: "   " },
          { role: "user", content: "\n\t" },
          { role: "assistant", content: "real response" },
        ],
        message: "",
      },
      "",
    );
    expect(transcript).toEqual([{ role: "assistant", content: "real response" }]);
  });

  it("omits the trailing user entry when payload.message is empty", () => {
    const transcript = buildRetainTranscript(
      { messages_history: [], message: "" },
      "tail assistant",
    );
    expect(transcript).toEqual([{ role: "assistant", content: "tail assistant" }]);
  });

  it("omits the trailing assistant entry when assistantContent is empty", () => {
    const transcript = buildRetainTranscript(
      { messages_history: [], message: "tail user" },
      "",
    );
    expect(transcript).toEqual([{ role: "user", content: "tail user" }]);
  });

  it("returns an empty list when nothing survives the filters", () => {
    const transcript = buildRetainTranscript(
      { messages_history: undefined, message: undefined },
      "",
    );
    expect(transcript).toEqual([]);
  });

  it("handles non-array messages_history defensively", () => {
    const transcript = buildRetainTranscript(
      { messages_history: "not an array" as unknown, message: "u" },
      "a",
    );
    expect(transcript).toEqual([
      { role: "user", content: "u" },
      { role: "assistant", content: "a" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildMemoryRetainRequest
// ---------------------------------------------------------------------------

describe("buildMemoryRetainRequest", () => {
  it("constructs the canonical {tenantId, userId, threadId, transcript} envelope", () => {
    const request = buildMemoryRetainRequest(
      BASE_PAYLOAD,
      makeIdentity(),
      "Your favorite is teal.",
    );
    expect(request).toEqual({
      tenantId: "tenant-1",
      userId: "user-1",
      threadId: "thread-1",
      transcript: [
        { role: "user", content: "my favorite color is teal" },
        { role: "assistant", content: "Noted! I'll remember that." },
        { role: "user", content: "what's my favorite color?" },
        { role: "assistant", content: "Your favorite is teal." },
      ],
    });
  });

  it("field-passthrough guard: every required envelope key is present and only those keys", () => {
    // Anti-subset-dict regression guard. If retainConversation grows a new
    // payload-derived field, update buildMemoryRetainRequest at the same
    // time — this test pins the shape so the addition is forced visible.
    const request = buildMemoryRetainRequest(
      BASE_PAYLOAD,
      makeIdentity(),
      "tail assistant",
    );
    expect(Object.keys(request).sort()).toEqual([
      "tenantId",
      "threadId",
      "transcript",
      "userId",
    ]);
  });
});

// ---------------------------------------------------------------------------
// retainConversation
// ---------------------------------------------------------------------------

describe("retainConversation", () => {
  it("happy path: invokes Lambda with InvocationType=Event and the canonical envelope", async () => {
    const recorded: SendCall[] = [];
    const lambdaClient = makeStubLambdaClient({ recorder: recorded });

    const result = await retainConversation({
      payload: BASE_PAYLOAD,
      identity: makeIdentity(),
      env: makeEnv(),
      assistantContent: "Your favorite is teal.",
      lambdaClient,
    });

    expect(result).toEqual({ retained: true });
    expect(recorded).toHaveLength(1);
    const call = recorded[0]!;
    expect(call.input.FunctionName).toBe("thinkwork-dev-api-memory-retain");
    expect(call.input.InvocationType).toBe("Event");
    expect(call.decodedPayload).toEqual({
      tenantId: "tenant-1",
      userId: "user-1",
      threadId: "thread-1",
      transcript: [
        { role: "user", content: "my favorite color is teal" },
        { role: "assistant", content: "Noted! I'll remember that." },
        { role: "user", content: "what's my favorite color?" },
        { role: "assistant", content: "Your favorite is teal." },
      ],
    });
  });

  it("opt-out: use_memory=false skips Lambda invoke", async () => {
    const sendSpy = vi.fn();
    const lambdaClient = { send: sendSpy } as unknown as LambdaClient;

    const result = await retainConversation({
      payload: { ...BASE_PAYLOAD, use_memory: false },
      identity: makeIdentity(),
      env: makeEnv(),
      assistantContent: "any",
      lambdaClient,
    });

    expect(result).toEqual({ retained: false });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("opt-in only: missing use_memory skips Lambda invoke", async () => {
    const sendSpy = vi.fn();
    const lambdaClient = { send: sendSpy } as unknown as LambdaClient;
    const { use_memory: _omit, ...withoutOptIn } = BASE_PAYLOAD;

    const result = await retainConversation({
      payload: withoutOptIn,
      identity: makeIdentity(),
      env: makeEnv(),
      assistantContent: "any",
      lambdaClient,
    });

    expect(result).toEqual({ retained: false });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("accepts the string 'true' as opt-in (parity with Pi optionalBoolean)", async () => {
    const recorded: SendCall[] = [];
    const lambdaClient = makeStubLambdaClient({ recorder: recorded });

    const result = await retainConversation({
      payload: { ...BASE_PAYLOAD, use_memory: "true" },
      identity: makeIdentity(),
      env: makeEnv(),
      assistantContent: "any",
      lambdaClient,
    });

    expect(result.retained).toBe(true);
    expect(recorded).toHaveLength(1);
  });

  it.each([
    ["tenantId", { tenantId: "" }],
    ["userId", { userId: "" }],
    ["threadId", { threadId: "" }],
  ])("missing identity field %s skips Lambda invoke", async (_label, override) => {
    const sendSpy = vi.fn();
    const lambdaClient = { send: sendSpy } as unknown as LambdaClient;

    const result = await retainConversation({
      payload: BASE_PAYLOAD,
      identity: makeIdentity(override),
      env: makeEnv(),
      assistantContent: "any",
      lambdaClient,
    });

    expect(result).toEqual({ retained: false });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("empty memoryRetainFnName skips Lambda invoke", async () => {
    const sendSpy = vi.fn();
    const lambdaClient = { send: sendSpy } as unknown as LambdaClient;

    const result = await retainConversation({
      payload: BASE_PAYLOAD,
      identity: makeIdentity(),
      env: makeEnv({ memoryRetainFnName: "" }),
      assistantContent: "any",
      lambdaClient,
    });

    expect(result).toEqual({ retained: false });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("empty transcript skips Lambda invoke", async () => {
    const sendSpy = vi.fn();
    const lambdaClient = { send: sendSpy } as unknown as LambdaClient;

    const result = await retainConversation({
      payload: { use_memory: true, message: "", messages_history: [] },
      identity: makeIdentity(),
      env: makeEnv(),
      assistantContent: "",
      lambdaClient,
    });

    expect(result).toEqual({ retained: false });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("Lambda invoke failure returns {retained: false, error} and never throws", async () => {
    const lambdaClient = makeStubLambdaClient({
      fail: new Error("boom: timeout"),
    });

    const result = await retainConversation({
      payload: BASE_PAYLOAD,
      identity: makeIdentity(),
      env: makeEnv(),
      assistantContent: "any",
      lambdaClient,
    });

    expect(result.retained).toBe(false);
    expect(result.error).toContain("boom: timeout");
  });

  it("non-Error rejection coerces to a string error", async () => {
    const lambdaClient = makeStubLambdaClient({
      fail: "string-rejection" as unknown as Error,
    });

    const result = await retainConversation({
      payload: BASE_PAYLOAD,
      identity: makeIdentity(),
      env: makeEnv(),
      assistantContent: "any",
      lambdaClient,
    });

    expect(result.retained).toBe(false);
    expect(result.error).toBe("string-rejection");
  });

  it("env-snapshot timing: uses env.memoryRetainFnName from the snapshot, ignoring later process.env mutation", async () => {
    const recorded: SendCall[] = [];
    const lambdaClient = makeStubLambdaClient({ recorder: recorded });

    // Simulate a snapshot taken at handler entry with a known fn name.
    const snapshot = makeEnv({ memoryRetainFnName: "fn-from-snapshot" });

    // Mutate process.env after the snapshot — must not affect the invoke.
    const original = process.env.MEMORY_RETAIN_FN_NAME;
    process.env.MEMORY_RETAIN_FN_NAME = "fn-from-process-env";
    try {
      await retainConversation({
        payload: BASE_PAYLOAD,
        identity: makeIdentity(),
        env: snapshot,
        assistantContent: "any",
        lambdaClient,
      });
    } finally {
      if (original === undefined) {
        delete process.env.MEMORY_RETAIN_FN_NAME;
      } else {
        process.env.MEMORY_RETAIN_FN_NAME = original;
      }
    }

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.input.FunctionName).toBe("fn-from-snapshot");
  });
});
