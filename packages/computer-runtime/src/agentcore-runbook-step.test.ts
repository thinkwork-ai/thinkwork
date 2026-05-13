import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  commands: [] as Array<Record<string, unknown>>,
  clients: [] as Array<Record<string, unknown>>,
}));

vi.mock("@aws-sdk/client-bedrock-agentcore", () => ({
  BedrockAgentCoreClient: vi.fn((input) => {
    mocks.clients.push(input);
    return {
      send: mocks.send,
    };
  }),
  InvokeAgentRuntimeCommand: vi.fn((input) => {
    mocks.commands.push(input);
    return { input };
  }),
}));

import { invokeRunbookAgentCoreStep } from "./agentcore-runbook-step.js";

describe("invokeRunbookAgentCoreStep", () => {
  beforeEach(() => {
    mocks.send.mockReset();
    mocks.commands = [];
    mocks.clients = [];
    delete process.env.RUNBOOK_AGENTCORE_INIT_RETRY_ATTEMPTS;
    delete process.env.RUNBOOK_AGENTCORE_INIT_RETRY_DELAY_MS;
    delete process.env.RUNBOOK_AGENTCORE_REQUEST_TIMEOUT_MS;
  });

  it("bounds AgentCore runbook steps to an 8 minute request timeout by default", async () => {
    mocks.send.mockResolvedValueOnce({
      response: JSON.stringify({ response: { content: "step complete" } }),
    });

    await invokeRunbookAgentCoreStep({
      provider: "bedrock-agentcore",
      runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:123:runtime/abc",
      runtimeSessionId: "run-session",
      payload: { message: "do the work" },
    });

    expect(mocks.clients[0]).toMatchObject({
      requestHandler: {
        requestTimeout: 8 * 60 * 1000,
      },
    });
  });

  it("retries transient AgentCore runtime initialization timeouts", async () => {
    process.env.RUNBOOK_AGENTCORE_INIT_RETRY_DELAY_MS = "1";
    mocks.send
      .mockRejectedValueOnce(
        new Error(
          "Runtime initialization time exceeded. Please make sure that initialization completes in 120s.",
        ),
      )
      .mockResolvedValueOnce({
        response: JSON.stringify({
          response: { content: "step complete" },
          usage: { inputTokens: 1 },
        }),
      });

    const result = await invokeRunbookAgentCoreStep({
      provider: "bedrock-agentcore",
      runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:123:runtime/abc",
      runtimeSessionId: "run-session",
      payload: { model: "model-1", message: "do the work" },
    });

    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.commands[0]).toMatchObject({
      runtimeSessionId: "run-session",
      payload: JSON.stringify({ model: "model-1", message: "do the work" }),
    });
    expect(result).toMatchObject({
      ok: true,
      responseText: "step complete",
      model: "model-1",
      usage: { inputTokens: 1 },
    });
  });

  it("does not retry non-initialization errors", async () => {
    mocks.send.mockRejectedValueOnce(new Error("AccessDenied"));

    await expect(
      invokeRunbookAgentCoreStep({
        provider: "bedrock-agentcore",
        runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:123:runtime/abc",
        runtimeSessionId: "run-session",
        payload: { message: "do the work" },
      }),
    ).rejects.toThrow("AccessDenied");

    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
