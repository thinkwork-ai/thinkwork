/**
 * THINK-946: the send → chat-agent-invoke window (4.5-7 s live, with a 30 s
 * outlier class) was unmeasurable because nothing on the Event payload said
 * when the caller fired it. invokeChatAgent now stamps the send moment, and
 * carries the mutation-start stamp its caller provides, so chat-agent-invoke
 * can attribute the window between mutation processing and Lambda
 * async-queue delivery.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(
  () => [] as Array<{ FunctionName?: string; Payload?: Uint8Array }>,
);

vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn(() => ({
    send: async (cmd: {
      input: { FunctionName?: string; Payload?: Uint8Array };
    }) => {
      sent.push(cmd.input);
      return {};
    },
  })),
  InvokeCommand: vi.fn((input) => ({ input })),
}));

const BASE = {
  threadId: "thread-1",
  tenantId: "tenant-1",
  agentId: "agent-1",
  messageId: "message-1",
  userMessage: "hi",
};

function sentPayload(): Record<string, unknown> {
  expect(sent).toHaveLength(1);
  return JSON.parse(new TextDecoder().decode(sent[0].Payload));
}

beforeEach(() => {
  vi.resetModules();
  sent.length = 0;
  vi.stubEnv(
    "CHAT_AGENT_INVOKE_FN_ARN",
    "arn:aws:lambda:us-east-1:1:function:thinkwork-test-api-chat-agent-invoke:live",
  );
});

describe("invokeChatAgent — pre-dispatch instrumentation", () => {
  it("stamps invokeSentAtMs on every Event payload", async () => {
    const { invokeChatAgent } = await import("./utils.js");
    const before = Date.now();
    await expect(invokeChatAgent(BASE)).resolves.toBe(true);
    const payload = sentPayload();
    expect(typeof payload.invokeSentAtMs).toBe("number");
    expect(payload.invokeSentAtMs as number).toBeGreaterThanOrEqual(before);
    expect(payload.invokeSentAtMs as number).toBeLessThanOrEqual(Date.now());
  });

  it("forwards the caller's mutation-start stamp untouched", async () => {
    const { invokeChatAgent } = await import("./utils.js");
    await invokeChatAgent({
      ...BASE,
      dispatchRequestedAtMs: 1_700_000_000_000,
    });
    expect(sentPayload().dispatchRequestedAtMs).toBe(1_700_000_000_000);
  });

  it("keeps the alias-qualified target (provisioned concurrency only serves the alias)", async () => {
    const { invokeChatAgent } = await import("./utils.js");
    await invokeChatAgent(BASE);
    expect(sent[0].FunctionName).toMatch(/:live$/);
  });
});
