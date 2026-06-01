import { describe, expect, it, vi } from "vitest";
import { BedrockModelProvider } from "./bedrock";
import { runAgentTurn } from "../loop";
import { defineTool } from "../session";
import type { Message, Tool } from "../types";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function echoTool(): Tool {
  return defineTool({
    name: "echo",
    description: "echo",
    parameters: { type: "object", properties: { v: { type: "string" } } },
    execute: async (args) => ({ content: `echo:${String(args.v)}` }),
  });
}

const user = (content: string): Message => ({ role: "user", content });

function makeProvider(fetchImpl: typeof fetch) {
  return new BedrockModelProvider({
    apiBase: "https://api.test",
    getToken: async () => "tok-123",
    fetchImpl,
  });
}

describe("BedrockModelProvider", () => {
  it("posts a provider-neutral body with the bearer token and maps the response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        text: "hello",
        toolCalls: [],
        stopReason: "end",
        usage: { inputTokens: 5, outputTokens: 2 },
        modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      }),
    );
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const res = await provider.generate({
      system: "be brief",
      messages: [user("hi")],
      tools: [
        { name: "echo", description: "echo", parameters: { type: "object" } },
      ],
      model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    });

    expect(res.text).toBe("hello");
    expect(res.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
    expect(res.modelId).toBe("us.anthropic.claude-sonnet-4-5-20250929-v1:0");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.test/api/model/converse");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok-123",
    });
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.system).toBe("be brief");
    expect(sent.messages).toEqual([user("hi")]);
    expect(sent.tools[0].name).toBe("echo");
  });

  it("drives a multi-step tool-calling turn through runAgentTurn (same seam as the mock)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          text: "checking",
          toolCalls: [{ id: "c1", name: "echo", arguments: { v: "ping" } }],
          stopReason: "tool_use",
          usage: { inputTokens: 3, outputTokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          text: "the echo said ping",
          toolCalls: [],
          stopReason: "end",
          usage: { inputTokens: 4, outputTokens: 2 },
        }),
      );
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const result = await runAgentTurn({
      provider,
      tools: [echoTool()],
      messages: [user("echo ping")],
    });

    expect(result.stopReason).toBe("completed");
    expect(result.finalText).toBe("the echo said ping");
    expect(result.steps).toBe(2);
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    const secondBody = JSON.parse(
      (fetchImpl.mock.calls[1][1] as RequestInit).body as string,
    );
    expect(secondBody.messages.some((m: Message) => m.role === "tool")).toBe(
      true,
    );
  });

  it("normalizes raw Bedrock toolUse blocks from older proxy responses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          text: "",
          toolCalls: [
            {
              toolUse: {
                toolUseId: "c1",
                name: "echo",
                input: { v: "ping" },
              },
            },
          ],
          stopReason: "tool_use",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          text: "the echo said ping",
          toolCalls: [],
          stopReason: "end",
        }),
      );
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const result = await runAgentTurn({
      provider,
      tools: [echoTool()],
      messages: [user("echo ping")],
    });

    expect(result.stopReason).toBe("completed");
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          toolCallId: "c1",
          name: "echo",
          content: "echo:ping",
        }),
      ]),
    );
  });

  it("normalizes direct toolUseId/input calls from proxy responses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          text: "",
          toolCalls: [{ toolUseId: "c1", name: "echo", input: { v: "pong" } }],
          stopReason: "tool_use",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          text: "done",
          toolCalls: [],
          stopReason: "completed",
        }),
      );
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const result = await runAgentTurn({
      provider,
      tools: [echoTool()],
      messages: [user("echo pong")],
    });

    expect(result.stopReason).toBe("completed");
    expect(result.finalText).toBe("done");
    expect(result.messages.at(-2)).toMatchObject({
      role: "tool",
      toolCallId: "c1",
      name: "echo",
      content: "echo:pong",
    });
  });

  it("throws on a non-ok proxy response so the loop reports an error stop reason", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: "model not allowlisted" }, false, 400),
      );
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const result = await runAgentTurn({
      provider,
      tools: [],
      messages: [user("hi")],
    });
    expect(result.stopReason).toBe("error");
  });

  it("throws when no token is available", async () => {
    const provider = new BedrockModelProvider({
      apiBase: "https://api.test",
      getToken: async () => null,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(
      provider.generate({ messages: [user("hi")], tools: [] }),
    ).rejects.toThrow(/Not authenticated/);
  });

  it("passes the abort signal through to fetch", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ text: "ok", toolCalls: [], stopReason: "end" }),
      );
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    const controller = new AbortController();
    await provider.generate(
      { messages: [user("hi")], tools: [] },
      controller.signal,
    );
    expect((fetchImpl.mock.calls[0][1] as RequestInit).signal).toBe(
      controller.signal,
    );
  });
});
