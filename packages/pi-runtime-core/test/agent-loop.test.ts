import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import {
  BUILTIN_TOOL_NAMES,
  buildToolAllowlist,
  buildTurnPrompt,
  runAgentLoop,
  toToolDefinition,
  type AgentSessionLike,
  type OpenSessionInputs,
} from "../src/agent-loop.js";
import type { RunAgentLoopArgs } from "../src/types.js";

function userMessage(text: string): AgentMessage {
  return { role: "user", content: text } as unknown as AgentMessage;
}

/** History entries are pi-ai `Message`s (user content is a string; assistant
 *  content is a `TextContent[]`), distinct from the session transcript's
 *  `AgentMessage`. */
function historyUser(text: string): Message {
  return { role: "user", content: text } as unknown as Message;
}

function historyAssistant(text: string): Message {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
  } as unknown as Message;
}

function fakeAgentTool(name: string): AgentTool<any> {
  return {
    name,
    label: `Label ${name}`,
    description: `Description for ${name}`,
    parameters: { type: "object", properties: { value: { type: "string" } } },
    execute: vi.fn(async () => ({
      content: [{ type: "text", text: `${name} ran` }],
      details: undefined,
    })),
  } as unknown as AgentTool<any>;
}

function assistantMessage(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    usage: {
      input: 11,
      output: 7,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 18,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  } as unknown as AgentMessage;
}

/**
 * Fake session that captures the subscriber, replays a fixed sequence of tool
 * events when prompted, then exposes a canned transcript. Lets us assert the
 * loop's deterministic orchestration without a live model.
 */
function makeFakeSession(options: {
  events?: AgentSessionEvent[];
  messages: AgentMessage[];
}): AgentSessionLike & { disposed: boolean; promptText?: string } {
  let listener: ((event: AgentSessionEvent) => void) | undefined;
  return {
    disposed: false,
    promptText: undefined,
    subscribe(fn) {
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
    async prompt(text: string) {
      (this as { promptText?: string }).promptText = text;
      for (const event of options.events ?? []) listener?.(event);
    },
    get messages() {
      return options.messages;
    },
    dispose() {
      (this as { disposed: boolean }).disposed = true;
    },
  };
}

function baseArgs(overrides: Partial<RunAgentLoopArgs> = {}): RunAgentLoopArgs {
  return {
    message: "hello",
    history: [],
    systemPrompt: "You are ThinkWork Pi.",
    tools: [],
    modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    threadId: "thread-1",
    gitSha: "abc123",
    ...overrides,
  };
}

describe("toToolDefinition", () => {
  it("maps the AgentTool fields onto a ToolDefinition", () => {
    const tool = fakeAgentTool("web_search");
    const def = toToolDefinition(tool);
    expect(def.name).toBe("web_search");
    expect(def.label).toBe("Label web_search");
    expect(def.description).toBe("Description for web_search");
    expect(def.parameters).toBe(tool.parameters);
  });

  it("forwards execute to the underlying AgentTool", async () => {
    const tool = fakeAgentTool("send_email");
    const def = toToolDefinition(tool);
    await def.execute(
      "call-1",
      { value: "x" },
      undefined,
      undefined,
      {} as never,
    );
    expect(tool.execute).toHaveBeenCalledWith(
      "call-1",
      { value: "x" },
      undefined,
      undefined,
    );
  });

  it("falls back to the tool name when no label is set", () => {
    const tool = fakeAgentTool("delegate");
    (tool as { label?: string }).label = undefined;
    expect(toToolDefinition(tool).label).toBe("delegate");
  });

  it("carries prepareArguments and executionMode when present, omits them when absent", () => {
    const bare = toToolDefinition(fakeAgentTool("bare"));
    expect("prepareArguments" in bare).toBe(false);
    expect("executionMode" in bare).toBe(false);

    const prepare = vi.fn((args: unknown) => args as never);
    const rich = fakeAgentTool("rich");
    (rich as { prepareArguments?: unknown }).prepareArguments = prepare;
    (rich as { executionMode?: string }).executionMode = "sequential";
    const def = toToolDefinition(rich);
    expect(def.prepareArguments).toBe(prepare);
    expect(def.executionMode).toBe("sequential");
  });
});

describe("buildToolAllowlist", () => {
  it("activates all seven built-ins plus the custom tool names", () => {
    const customs = [
      toToolDefinition(fakeAgentTool("web_search")),
      toToolDefinition(fakeAgentTool("execute_code")),
    ];
    const allowlist = buildToolAllowlist(customs);
    for (const builtin of BUILTIN_TOOL_NAMES) {
      expect(allowlist).toContain(builtin);
    }
    expect(allowlist).toContain("web_search");
    expect(allowlist).toContain("execute_code");
    expect(allowlist).toHaveLength(BUILTIN_TOOL_NAMES.length + 2);
  });

  it("includes the full built-in set even with no custom tools", () => {
    expect(buildToolAllowlist([])).toEqual([...BUILTIN_TOOL_NAMES]);
  });

  it("de-duplicates when a custom tool reuses a built-in name", () => {
    const allowlist = buildToolAllowlist([
      toToolDefinition(fakeAgentTool("read")),
      toToolDefinition(fakeAgentTool("web_search")),
    ]);
    expect(allowlist.filter((name) => name === "read")).toHaveLength(1);
    expect(allowlist).toHaveLength(BUILTIN_TOOL_NAMES.length + 1);
    expect(allowlist).toContain("web_search");
  });
});

describe("buildTurnPrompt", () => {
  it("sends only the current message when there is no history", () => {
    const prompt = buildTurnPrompt(baseArgs({ message: "hello" }));
    expect(prompt).toBe("Current user message:\nhello");
  });

  it("prepends prior conversation as text (user + assistant roles)", () => {
    const prompt = buildTurnPrompt(
      baseArgs({
        message: "and now?",
        history: [
          historyUser("first question"),
          historyAssistant("first answer"),
        ],
      }),
    );
    expect(prompt).toContain("Prior conversation:");
    expect(prompt).toContain("user: first question");
    expect(prompt).toContain("assistant: first answer");
    expect(prompt).toContain("Current user message:\nand now?");
  });

  it("skips empty/whitespace history entries", () => {
    const prompt = buildTurnPrompt(
      baseArgs({ history: [historyUser("   "), historyAssistant("real")] }),
    );
    expect(prompt).not.toContain("user:");
    expect(prompt).toContain("assistant: real");
  });
});

describe("runAgentLoop", () => {
  it("passes the built-ins + custom tool allowlist and prompt to the session", async () => {
    let captured: OpenSessionInputs | undefined;
    const session = makeFakeSession({ messages: [assistantMessage("hi")] });
    await runAgentLoop(baseArgs({ tools: [fakeAgentTool("web_search")] }), {
      openSession: async (inputs) => {
        captured = inputs;
        return { session, modelId: inputs.modelId };
      },
    });
    expect(captured?.toolAllowlist).toEqual([
      ...BUILTIN_TOOL_NAMES,
      "web_search",
    ]);
    expect(captured?.customTools.map((tool) => tool.name)).toEqual([
      "web_search",
    ]);
    expect(captured?.systemPrompt).toBe("You are ThinkWork Pi.");
  });

  it("extracts assistant content, usage, and resolved model id", async () => {
    const session = makeFakeSession({
      messages: [assistantMessage("the answer")],
    });
    const result = await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "resolved-model" }),
    });
    expect(result.content).toBe("the answer");
    expect(result.usage?.totalTokens).toBe(18);
    expect(result.modelId).toBe("resolved-model");
    expect(session.disposed).toBe(true);
  });

  it("collects tool invocations and called tools from session events", async () => {
    const session = makeFakeSession({
      messages: [assistantMessage("done")],
      events: [
        {
          type: "tool_execution_start",
          toolCallId: "c1",
          toolName: "web_search",
          args: { query: "weather" },
        } as AgentSessionEvent,
        {
          type: "tool_execution_end",
          toolCallId: "c1",
          toolName: "web_search",
          result: { content: [{ type: "text", text: "sunny" }] },
          isError: false,
        } as AgentSessionEvent,
      ],
    });
    const result = await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "m" }),
    });
    expect(result.toolsCalled).toEqual(["web_search"]);
    expect(result.toolInvocations).toHaveLength(1);
    const invocation = result.toolInvocations[0];
    expect(invocation.id).toBe("c1");
    expect(invocation.status).toBe("ok");
    expect(invocation.input_preview).toContain("weather");
    expect(invocation.output_preview).toContain("sunny");
    expect(invocation.finished_at).toBeTruthy();
  });

  it("marks errored tool executions as error status", async () => {
    const session = makeFakeSession({
      messages: [assistantMessage("done")],
      events: [
        {
          type: "tool_execution_start",
          toolCallId: "c2",
          toolName: "execute_code",
          args: { code: "boom" },
        } as AgentSessionEvent,
        {
          type: "tool_execution_end",
          toolCallId: "c2",
          toolName: "execute_code",
          result: "error detail",
          isError: true,
        } as AgentSessionEvent,
      ],
    });
    const result = await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "m" }),
    });
    expect(result.toolInvocations[0].status).toBe("error");
    expect(result.toolInvocations[0].is_error).toBe(true);
  });

  it("disposes the session even when the prompt throws", async () => {
    const session = makeFakeSession({ messages: [] });
    session.prompt = vi.fn(async () => {
      throw new Error("model exploded");
    });
    await expect(
      runAgentLoop(baseArgs(), {
        openSession: async () => ({ session, modelId: "m" }),
      }),
    ).rejects.toThrow("model exploded");
    expect(session.disposed).toBe(true);
  });

  it("returns empty content when no assistant message is present", async () => {
    const session = makeFakeSession({ messages: [] });
    const result = await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "m" }),
    });
    expect(result.content).toBe("");
    expect(result.toolsCalled).toEqual([]);
  });

  it("seeds prior conversation into the prompt sent to the session", async () => {
    const session = makeFakeSession({ messages: [assistantMessage("ok")] });
    await runAgentLoop(
      baseArgs({
        message: "follow up",
        history: [
          historyUser("earlier ask"),
          historyAssistant("earlier reply"),
        ],
      }),
      { openSession: async () => ({ session, modelId: "m" }) },
    );
    expect(session.promptText).toContain("user: earlier ask");
    expect(session.promptText).toContain("assistant: earlier reply");
    expect(session.promptText).toContain("Current user message:\nfollow up");
  });

  it("records a tool_execution_end with no preceding start (orphan end)", async () => {
    const session = makeFakeSession({
      messages: [assistantMessage("done")],
      events: [
        {
          type: "tool_execution_end",
          toolCallId: "orphan",
          toolName: "grep",
          result: "match",
          isError: false,
        } as AgentSessionEvent,
      ],
    });
    const result = await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "m" }),
    });
    expect(result.toolsCalled).toEqual(["grep"]);
    expect(result.toolInvocations).toHaveLength(1);
    expect(result.toolInvocations[0].status).toBe("ok");
    expect(result.toolInvocations[0].started_at).toBeUndefined();
    expect(result.toolInvocations[0].finished_at).toBeTruthy();
  });

  it("correlates interleaved tool calls by id and de-dupes toolsCalled by name", async () => {
    const session = makeFakeSession({
      messages: [assistantMessage("done")],
      events: [
        {
          type: "tool_execution_start",
          toolCallId: "a",
          toolName: "web_search",
          args: { q: "1" },
        } as AgentSessionEvent,
        {
          type: "tool_execution_start",
          toolCallId: "b",
          toolName: "web_search",
          args: { q: "2" },
        } as AgentSessionEvent,
        {
          type: "tool_execution_end",
          toolCallId: "b",
          toolName: "web_search",
          result: "second",
          isError: false,
        } as AgentSessionEvent,
        {
          type: "tool_execution_end",
          toolCallId: "a",
          toolName: "web_search",
          result: "first",
          isError: false,
        } as AgentSessionEvent,
      ],
    });
    const result = await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "m" }),
    });
    expect(result.toolsCalled).toEqual(["web_search"]);
    expect(result.toolInvocations).toHaveLength(2);
    const byId = Object.fromEntries(
      result.toolInvocations.map((inv) => [inv.id, inv.output_preview]),
    );
    expect(byId.a).toContain("first");
    expect(byId.b).toContain("second");
  });

  it("returns the last assistant message in a multi-turn transcript", async () => {
    const session = makeFakeSession({
      messages: [
        assistantMessage("first"),
        userMessage("again"),
        assistantMessage("final"),
      ],
    });
    const result = await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "m" }),
    });
    expect(result.content).toBe("final");
  });

  it("falls back to the default model id when none is provided", async () => {
    let captured: OpenSessionInputs | undefined;
    const session = makeFakeSession({ messages: [assistantMessage("ok")] });
    await runAgentLoop(baseArgs({ modelId: undefined }), {
      openSession: async (inputs) => {
        captured = inputs;
        return { session, modelId: inputs.modelId };
      },
    });
    expect(captured?.modelId).toBe(
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    );
  });

  it("passes the session store + threadId + seedHistory through to openSession", async () => {
    let captured: OpenSessionInputs | undefined;
    const session = makeFakeSession({ messages: [assistantMessage("ok")] });
    const sessionStore = { read: async () => null, write: async () => "1" };
    await runAgentLoop(
      baseArgs({
        threadId: "t-9",
        history: [historyUser("prior")],
        sessionStore,
        sessionDir: "/tmp/sessions",
      }),
      {
        openSession: async (inputs) => {
          captured = inputs;
          return { session, modelId: inputs.modelId };
        },
      },
    );
    expect(captured?.sessionStore).toBe(sessionStore);
    expect(captured?.threadId).toBe("t-9");
    expect(captured?.sessionDir).toBe("/tmp/sessions");
    expect(captured?.seedHistory).toHaveLength(1);
  });

  it("sends only the new message (no history prepend) and persists when durable", async () => {
    const session = makeFakeSession({ messages: [assistantMessage("ok")] });
    let persisted = 0;
    await runAgentLoop(
      baseArgs({
        message: "current",
        history: [historyUser("earlier")],
      }),
      {
        openSession: async () => ({
          session,
          modelId: "m",
          durable: true,
          persistSession: async () => {
            persisted += 1;
          },
        }),
      },
    );
    expect(session.promptText).toBe("current");
    expect(session.promptText).not.toContain("Prior conversation");
    expect(persisted).toBe(1);
  });

  it("does not persist the durable session when the prompt throws", async () => {
    const session = makeFakeSession({ messages: [] });
    session.prompt = vi.fn(async () => {
      throw new Error("turn failed");
    });
    let persisted = 0;
    await expect(
      runAgentLoop(baseArgs(), {
        openSession: async () => ({
          session,
          modelId: "m",
          durable: true,
          persistSession: async () => {
            persisted += 1;
          },
        }),
      }),
    ).rejects.toThrow("turn failed");
    expect(persisted).toBe(0);
    expect(session.disposed).toBe(true);
  });
});
