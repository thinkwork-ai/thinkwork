import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import { createTaskReviewJsonRenderFixture } from "@thinkwork/thread-json-render";
import { mkdtemp, readlink, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  askUserQuestionEndTurn,
  BUILTIN_TOOL_NAMES,
  buildToolAllowlist,
  buildTurnPrompt,
  preparePiAgentDirectory,
  resolveRequiredBedrockModel,
  runAgentLoop,
  toToolDefinition,
  type AgentSessionLike,
  type OpenSessionInputs,
} from "../src/agent-loop.js";
import { SessionConflictError } from "../src/durable-session-manager.js";
import { EMIT_JSON_RENDER_UI_TOOL_NAME } from "../src/json-render-runtime.js";
import { UnsupportedModelError } from "../src/model-provider.js";
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

function assistantErrorMessage(errorMessage: string): AgentMessage {
  return {
    role: "assistant",
    content: [],
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage,
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

describe("resolveRequiredBedrockModel", () => {
  it("returns the requested Bedrock model when it is registered", () => {
    const model = { id: "anthropic.claude-haiku" };
    const find = vi.fn(() => model);

    expect(resolveRequiredBedrockModel({ find }, model.id)).toBe(model);
    expect(find).toHaveBeenCalledWith("amazon-bedrock", model.id);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("throws for an unregistered model without looking up a default", () => {
    const find = vi.fn(() => undefined);

    expect(() =>
      resolveRequiredBedrockModel({ find }, "anthropic.claude-fable-5"),
    ).toThrow(UnsupportedModelError);
    expect(find).toHaveBeenCalledWith(
      "amazon-bedrock",
      "anthropic.claude-fable-5",
    );
    expect(find).toHaveBeenCalledTimes(1);
  });
});

describe("buildToolAllowlist", () => {
  it("keeps all seven built-ins plus the custom tool names, including bash with execute_code", () => {
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

  it("includes extension tool names so extension tools are actually enabled (U6)", () => {
    const allowlist = buildToolAllowlist(
      [toToolDefinition(fakeAgentTool("execute_code"))],
      ["recall", "reflect"],
    );
    expect(allowlist).toContain("recall");
    expect(allowlist).toContain("reflect");
    expect(allowlist).toContain("execute_code");
    for (const builtin of BUILTIN_TOOL_NAMES) {
      expect(allowlist).toContain(builtin);
    }
    expect(allowlist).toHaveLength(BUILTIN_TOOL_NAMES.length + 3);
  });

  it("includes pi-goal's goal_complete extension tool in the allowlist", () => {
    const allowlist = buildToolAllowlist([], ["goal_complete"]);
    expect(allowlist).toContain("goal_complete");
    for (const builtin of BUILTIN_TOOL_NAMES) {
      expect(allowlist).toContain(builtin);
    }
    expect(allowlist).toHaveLength(BUILTIN_TOOL_NAMES.length + 1);
  });

  it("supports a narrowed built-in allowlist for child profile runs", () => {
    const allowlist = buildToolAllowlist(
      [toToolDefinition(fakeAgentTool("profile_tool"))],
      ["web_search"],
      ["read"],
    );
    expect(allowlist).toEqual(["read", "profile_tool", "web_search"]);
    expect(allowlist).not.toContain("bash");
    expect(allowlist).not.toContain("write");
  });

  it("forwards extensionToolNames through to openSession (U6 allowlist fix)", async () => {
    let captured: OpenSessionInputs | undefined;
    const session = makeFakeSession({ messages: [assistantMessage("ok")] });
    await runAgentLoop(
      baseArgs({ extensionToolNames: ["recall", "reflect"] }),
      {
        openSession: async (inputs) => {
          captured = inputs;
          return { session, modelId: inputs.modelId };
        },
      },
    );
    expect(captured?.toolAllowlist).toContain("recall");
    expect(captured?.toolAllowlist).toContain("reflect");
  });

  it("extracts agent profile run evidence from profile delegation tool results", async () => {
    const profileRun = {
      profileRunId: "profile-run-1",
      profileId: "profile-research",
      profileSlug: "research",
      profileName: "Research",
      model: "anthropic/claude-haiku-4-5",
      status: "completed" as const,
      startedAt: "2026-06-07T12:00:00.000Z",
      finishedAt: "2026-06-07T12:00:01.000Z",
      durationMs: 1000,
      inputTokens: 10,
      outputTokens: 20,
      parentThreadTurnId: "turn-parent",
      handoffSummary: "Research handoff",
      toolInvocations: [],
      laneKey: "profile:research",
    };
    const session = makeFakeSession({
      events: [
        {
          type: "tool_execution_start",
          toolCallId: "tool-call-1",
          toolName: "delegate_to_agent_profile",
          args: { profileSlug: "research", task: "find sources" },
        } as AgentSessionEvent,
        {
          type: "tool_execution_end",
          toolCallId: "tool-call-1",
          toolName: "delegate_to_agent_profile",
          result: { details: { agentProfileRun: profileRun } },
          isError: false,
        } as AgentSessionEvent,
      ],
      messages: [assistantMessage("parent summary")],
    });

    const result = await runAgentLoop(baseArgs(), {
      openSession: async (inputs) => ({ session, modelId: inputs.modelId }),
    });

    expect(result.agentProfileRuns).toEqual([profileRun]);
    expect(result.toolInvocations[0]?.agent_profile_run).toEqual(profileRun);
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

describe("preparePiAgentDirectory", () => {
  it("creates the target for a dangling workspace symlink before creating the Pi agent dir", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-agent-dir-"));
    const target = path.join(root, "tmp-workspace");
    const workspace = path.join(root, "workspace");
    await symlink(target, workspace);

    try {
      const agentDir = await preparePiAgentDirectory(workspace);

      expect(await readlink(workspace)).toBe(target);
      expect(agentDir).toBe(path.join(workspace, ".thinkwork-pi"));
      expect((await stat(agentDir)).isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("supports keeping the Pi agent dir outside the rendered workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-agent-dir-"));
    const workspace = path.join(root, "workspace");
    const agentDir = path.join(root, "scratch", "pi-agent");

    try {
      const resolved = await preparePiAgentDirectory(workspace, agentDir);

      expect(resolved).toBe(agentDir);
      expect((await stat(workspace)).isDirectory()).toBe(true);
      expect((await stat(agentDir)).isDirectory()).toBe(true);
      await expect(
        stat(path.join(workspace, ".thinkwork-pi")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("runAgentLoop", () => {
  it("passes the built-ins + custom tool allowlist and prompt to the session", async () => {
    let captured: OpenSessionInputs | undefined;
    const session = makeFakeSession({ messages: [assistantMessage("hi")] });
    await runAgentLoop(
      baseArgs({
        agentDir: "/tmp/thinkwork-pi-agent",
        tools: [fakeAgentTool("web_search")],
      }),
      {
        openSession: async (inputs) => {
          captured = inputs;
          return { session, modelId: inputs.modelId };
        },
      },
    );
    expect(captured?.agentDir).toBe("/tmp/thinkwork-pi-agent");
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

  it("sets logical PWD to the workspace cwd while prompting", async () => {
    const originalPwd = process.env.PWD;
    process.env.PWD = "/previous";
    const session = makeFakeSession({ messages: [assistantMessage("ok")] });
    let promptPwd: string | undefined;
    session.prompt = vi.fn(async () => {
      promptPwd = process.env.PWD;
    });

    try {
      await runAgentLoop(baseArgs({ cwd: "/workspace" }), {
        openSession: async () => ({ session, modelId: "m" }),
      });
      expect(promptPwd).toBe("/workspace");
      expect(process.env.PWD).toBe("/previous");
    } finally {
      if (originalPwd === undefined) {
        delete process.env.PWD;
      } else {
        process.env.PWD = originalPwd;
      }
    }
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

  it("records model-routed tool call metadata from tool results", async () => {
    const session = makeFakeSession({
      messages: [assistantMessage("done")],
      events: [
        {
          type: "tool_execution_start",
          toolCallId: "c1",
          toolName: "workspace_skill",
          args: { slug: "research" },
        } as AgentSessionEvent,
        {
          type: "tool_execution_end",
          toolCallId: "c1",
          toolName: "workspace_skill",
          result: {
            content: [{ type: "text", text: "routed answer" }],
            details: {
              modelRouting: {
                toolName: "workspace_skill",
                match: { slug: "research" },
                model: "us.amazon.nova-micro-v1:0",
                ruleSource: {
                  path: "/workspace/User/TOOLS.md",
                  owner: "user",
                  precedence: 300,
                },
                status: "completed",
                inputTokens: 12,
                outputTokens: 5,
                totalTokens: 17,
                durationMs: 42,
              },
            },
          },
          isError: false,
        } as AgentSessionEvent,
      ],
    });

    const result = await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "m" }),
    });

    expect(result.toolInvocations[0].model_routing).toEqual({
      toolCallId: "c1",
      toolName: "workspace_skill",
      match: { slug: "research" },
      model: "us.amazon.nova-micro-v1:0",
      ruleSource: {
        path: "/workspace/User/TOOLS.md",
        owner: "user",
        precedence: 300,
      },
      status: "completed",
      inputTokens: 12,
      outputTokens: 5,
      totalTokens: 17,
      durationMs: 42,
    });
    expect(result.modelRoutedToolCalls).toEqual([
      result.toolInvocations[0].model_routing,
    ]);
  });

  it("records model-routed MCP metadata from wrapped SDK tool results", async () => {
    const routing = {
      toolName: "mcp_twenty-crm_execute_tool",
      match: {
        serverName: "twenty-crm",
        tool: "mcp_twenty-crm_execute_tool",
      },
      model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      ruleSource: {
        path: "/workspace/TOOLS.md",
        owner: "workspace",
        precedence: 200,
      },
      status: "completed",
      inputTokens: 91,
      outputTokens: 13,
      cachedReadTokens: 7,
      totalTokens: 111,
      durationMs: 35,
    };
    const resultPayloads = [
      {
        content: [{ type: "text", text: "normalized result" }],
        modelRouting: routing,
      },
      {
        content: [{ type: "text", text: "wrapped result" }],
        result: { details: { modelRouting: routing } },
      },
      {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              content: [{ type: "text", text: "serialized result" }],
              details: { modelRouting: routing },
            }),
          },
        ],
      },
    ];

    for (const resultPayload of resultPayloads) {
      const session = makeFakeSession({
        messages: [assistantMessage("done")],
        events: [
          {
            type: "tool_execution_start",
            toolCallId: "mcp-call-1",
            toolName: "mcp_twenty-crm_execute_tool",
            args: { name: "find_many_opportunities" },
          } as AgentSessionEvent,
          {
            type: "tool_execution_end",
            toolCallId: "mcp-call-1",
            toolName: "mcp_twenty-crm_execute_tool",
            result: resultPayload,
            isError: false,
          } as AgentSessionEvent,
        ],
      });

      const result = await runAgentLoop(baseArgs(), {
        openSession: async () => ({ session, modelId: "m" }),
      });

      expect(result.toolInvocations[0].model_routing).toEqual({
        toolCallId: "mcp-call-1",
        toolName: "mcp_twenty-crm_execute_tool",
        match: {
          serverName: "twenty-crm",
          tool: "mcp_twenty-crm_execute_tool",
        },
        model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        ruleSource: {
          path: "/workspace/TOOLS.md",
          owner: "workspace",
          precedence: 200,
        },
        status: "completed",
        inputTokens: 91,
        outputTokens: 13,
        cachedReadTokens: 7,
        totalTokens: 111,
        durationMs: 35,
      });
      expect(result.modelRoutedToolCalls).toEqual([
        result.toolInvocations[0].model_routing,
      ]);
    }
  });

  it("fires emitActivity on tool start + end with the dedup-contract shape (U5)", async () => {
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
    const emitted: Array<{ eventType: string; message: string }> = [];
    await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "m" }),
      emitActivity: (e) =>
        emitted.push({ eventType: e.eventType, message: e.message }),
    });
    expect(emitted).toEqual([
      { eventType: "tool_invocation_started", message: "web_search" },
      { eventType: "tool_invocation_completed", message: "web_search" },
    ]);
  });

  it("emits OKF wiki context trace activity from navigator tool results", async () => {
    const session = makeFakeSession({
      messages: [assistantMessage("done")],
      events: [
        {
          type: "tool_execution_start",
          toolCallId: "wiki-call-1",
          toolName: "wiki_rg",
          args: { query: "Acme", path: "topics" },
        } as AgentSessionEvent,
        {
          type: "tool_execution_end",
          toolCallId: "wiki-call-1",
          toolName: "wiki_rg",
          result: {
            content: [{ type: "text", text: "OKF wiki matches" }],
            details: {
              okfWikiTrace: {
                surface: "okf_efs",
                tool: "wiki_rg",
                query: "Acme",
                path: "topics",
                matchCount: 1,
                entries: [{ path: "topics/acme.md", title: "Acme" }],
                bounds: {
                  maxResults: 5,
                  maxDepth: 2,
                  maxBytes: 128_000,
                  truncated: false,
                },
                redaction: {
                  source: "okf_navigator",
                  policy: "cite_or_summarize_only",
                },
              },
            },
          },
          isError: false,
        } as AgentSessionEvent,
      ],
    });
    const emitted: Array<{
      eventType: string;
      message: string;
      payload?: Record<string, unknown>;
    }> = [];
    const result = await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "m" }),
      emitActivity: (event) => emitted.push(event),
    });

    expect(result.toolInvocations[0].okf_wiki_trace).toMatchObject({
      tool_call_id: "wiki-call-1",
      tool: "wiki_rg",
      query: "Acme",
      matchCount: 1,
    });
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "wiki_context_trace",
          message: 'OKF wiki search returned 1 item for "Acme"',
          payload: expect.objectContaining({
            tool_call_id: "wiki-call-1",
            tool: "wiki_rg",
            query: "Acme",
          }),
        }),
      ]),
    );
  });

  it("emits and returns Thread json-render parts from the explicit emit tool", async () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const session = makeFakeSession({
      messages: [assistantMessage("done")],
      events: [
        {
          type: "tool_execution_start",
          toolCallId: "c1",
          toolName: EMIT_JSON_RENDER_UI_TOOL_NAME,
          args: { taskId: "task-123" },
        } as AgentSessionEvent,
        {
          type: "tool_execution_end",
          toolCallId: "c1",
          toolName: EMIT_JSON_RENDER_UI_TOOL_NAME,
          result: {
            content: [{ type: "text", text: "review ready" }],
            details: { thread_json_render_part: fixture },
          },
          isError: false,
        } as AgentSessionEvent,
      ],
    });
    const emitted: Array<{
      eventType: string;
      stream?: string;
      payload?: unknown;
    }> = [];

    const result = await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "m" }),
      emitActivity: (event) => emitted.push(event),
    });

    expect(result.uiMessageParts).toEqual([fixture]);
    expect(emitted).toContainEqual(
      expect.objectContaining({
        eventType: "ui_message_chunk",
        stream: "ui",
        payload: {
          kind: "thread_json_render.ui_message_chunk",
          chunk: fixture,
        },
      }),
    );
  });

  it("does not trust json-render-looking payloads from arbitrary tool results", async () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const session = makeFakeSession({
      messages: [assistantMessage("done")],
      events: [
        {
          type: "tool_execution_end",
          toolCallId: "c1",
          toolName: "review_task",
          result: {
            content: [{ type: "text", text: "review ready" }],
            details: { thread_json_render_part: fixture },
          },
          isError: false,
        } as AgentSessionEvent,
      ],
    });

    const result = await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "m" }),
    });

    expect(result.uiMessageParts).toBeUndefined();
  });

  it("never lets a throwing emitActivity break the turn (best-effort, D1)", async () => {
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
      emitActivity: () => {
        throw new Error("emitter boom");
      },
    });
    // The turn still completes and collects its invocations normally.
    expect(result.toolInvocations).toHaveLength(1);
    expect(result.toolInvocations[0].status).toBe("ok");
  });

  it("logs span-shaped phase records for tool execution", async () => {
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
    const logs: Array<Record<string, unknown>> = [];
    await runAgentLoop(
      baseArgs({
        identity: {
          tenantId: "tenant-1",
          userId: "user-1",
          agentId: "agent-1",
          threadId: "thread-1",
          traceId: "trace-1",
        },
      }),
      {
        openSession: async () => ({ session, modelId: "m" }),
        log: (entry) => logs.push(entry),
      },
    );

    expect(logs).toEqual([
      expect.objectContaining({
        event: "agentcore_phase",
        name: "thinkwork.agentcore.phase",
        spanId: "tw-runtime.tool_execution-c1",
        phase: "runtime.tool_execution",
        status: "started",
        source: "agentcore-pi",
        tenantId: "tenant-1",
        traceId: "trace-1",
        detail: "web_search",
      }),
      expect.objectContaining({
        event: "agentcore_phase",
        name: "thinkwork.agentcore.phase",
        spanId: "tw-runtime.tool_execution-c1",
        phase: "runtime.tool_execution",
        status: "completed",
        durationMs: expect.any(Number),
      }),
    ]);
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

  it("rejects a missing model id instead of selecting a default", async () => {
    const openSession = vi.fn();
    const session = makeFakeSession({ messages: [assistantMessage("ok")] });
    openSession.mockResolvedValue({ session, modelId: "unused" });

    await expect(
      runAgentLoop(baseArgs({ modelId: undefined }), { openSession }),
    ).rejects.toThrow(UnsupportedModelError);
    expect(openSession).not.toHaveBeenCalled();
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

  it("forwards extension factories through to openSession (U5 loading seam)", async () => {
    let captured: OpenSessionInputs | undefined;
    const session = makeFakeSession({ messages: [assistantMessage("ok")] });
    const factory = () => {};
    await runAgentLoop(baseArgs({ extensionFactories: [factory] }), {
      openSession: async (inputs) => {
        captured = inputs;
        return { session, modelId: inputs.modelId };
      },
    });
    expect(captured?.extensionFactories).toEqual([factory]);
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

  it("returns the assistant reply even when persisting the durable session conflicts", async () => {
    const session = makeFakeSession({
      messages: [assistantMessage("the reply")],
    });
    const logged: { level: string; event: string }[] = [];
    const result = await runAgentLoop(baseArgs(), {
      log: (e) => logged.push({ level: e.level, event: e.event }),
      openSession: async () => ({
        session,
        modelId: "m",
        durable: true,
        persistSession: async () => {
          throw new SessionConflictError("raced");
        },
      }),
    });
    // The model output is valid; a lost persist race must not fail the turn.
    expect(result.content).toBe("the reply");
    expect(logged).toContainEqual({
      level: "warn",
      event: "durable_session_persist_conflict",
    });
  });

  it("fails the turn when the SDK records an assistant error", async () => {
    const session = makeFakeSession({
      messages: [assistantErrorMessage("AccessDeniedException: denied")],
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
    ).rejects.toThrow("AccessDeniedException: denied");
    expect(persisted).toBe(0);
    expect(session.disposed).toBe(true);
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

describe("ask_user_question turn-end (U5)", () => {
  const sentinelResult = {
    content: [{ type: "text", text: "Question posted to the user." }],
    details: { thinkworkAskUserQuestion: { questionId: "q-1", endTurn: true } },
    terminate: true,
  };

  function askEvents(result: unknown, isError = false): AgentSessionEvent[] {
    return [
      {
        type: "tool_execution_start",
        toolCallId: "ask-1",
        toolName: "ask_user_question",
        args: { questions: [] },
      } as AgentSessionEvent,
      {
        type: "tool_execution_end",
        toolCallId: "ask-1",
        toolName: "ask_user_question",
        result,
        isError,
      } as AgentSessionEvent,
    ];
  }

  describe("askUserQuestionEndTurn", () => {
    it("detects the sentinel detail flag under details", () => {
      expect(askUserQuestionEndTurn(sentinelResult)).toBe(true);
    });

    it("rejects the flattened (non-canonical) result-record shape", () => {
      expect(
        askUserQuestionEndTurn({
          thinkworkAskUserQuestion: { endTurn: true },
        }),
      ).toBe(false);
    });

    it("ignores error results, foreign details, and non-record results", () => {
      expect(
        askUserQuestionEndTurn({
          details: { thinkworkAskUserQuestion: { error: "409" } },
        }),
      ).toBe(false);
      expect(
        askUserQuestionEndTurn({
          details: { thinkworkAskUserQuestion: { endTurn: "yes" } },
        }),
      ).toBe(false);
      expect(askUserQuestionEndTurn({ details: { other: true } })).toBe(false);
      expect(askUserQuestionEndTurn("text result")).toBe(false);
      expect(askUserQuestionEndTurn(undefined)).toBe(false);
    });
  });

  it("ignores the sentinel when carried on another tool's result (no abort)", async () => {
    const session = makeFakeSession({
      messages: [assistantMessage("done")],
      events: [
        {
          type: "tool_execution_start",
          toolCallId: "mcp-1",
          toolName: "some_mcp_tool",
          args: {},
        } as AgentSessionEvent,
        {
          type: "tool_execution_end",
          toolCallId: "mcp-1",
          toolName: "some_mcp_tool",
          result: sentinelResult,
          isError: false,
        } as AgentSessionEvent,
      ],
    });
    const abort = vi.fn(async () => {});
    (session as AgentSessionLike).abort = abort;

    const result = await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "m" }),
    });
    expect(abort).not.toHaveBeenCalled();
    expect(result.content).toBe("done");
  });

  it("calls session.abort after the sentinel tool result is recorded", async () => {
    const session = makeFakeSession({
      messages: [assistantMessage("asking…")],
      events: askEvents(sentinelResult),
    });
    const abort = vi.fn(async () => {});
    (session as AgentSessionLike).abort = abort;

    const result = await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "m" }),
    });

    expect(abort).toHaveBeenCalledTimes(1);
    // The tool result was recorded BEFORE the turn ended.
    expect(result.toolInvocations).toHaveLength(1);
    expect(result.toolInvocations[0].status).toBe("ok");
    expect(result.toolsCalled).toEqual(["ask_user_question"]);
  });

  it("ends the turn on the 409 already-pending sentinel (same terminate path, success preserved)", async () => {
    const alreadyPendingResult = {
      content: [{ type: "text", text: "Error: a question is already pending" }],
      details: {
        thinkworkAskUserQuestion: { endTurn: true, alreadyPending: true },
      },
      terminate: true,
    };
    const session = makeFakeSession({
      messages: [assistantMessage("asking…")],
      events: askEvents(alreadyPendingResult),
    });
    const abort = vi.fn(async () => {});
    (session as AgentSessionLike).abort = abort;

    const result = await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "m" }),
    });
    expect(abort).toHaveBeenCalledTimes(1);
    expect(result.content).toBe("asking…");
    expect(result.toolInvocations[0].status).toBe("ok");
  });

  it("finalizes the turn as a SUCCESS, skipping a trailing abort stub when extracting content", async () => {
    const abortedStub = {
      role: "assistant",
      content: [],
      stopReason: "aborted",
    } as unknown as AgentMessage;
    const session = makeFakeSession({
      messages: [assistantMessage("I need to check one thing."), abortedStub],
      events: askEvents(sentinelResult),
    });
    (session as AgentSessionLike).abort = vi.fn(async () => {});

    const result = await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "m" }),
    });

    // No throw (success), and content comes from the real assistant
    // message, not the empty aborted stub appended by the abort backstop.
    expect(result.content).toBe("I need to check one thing.");
  });

  it("does not fail the turn when the abort backstop leaves an error-shaped trailing stub", async () => {
    const session = makeFakeSession({
      messages: [
        assistantMessage("asking…"),
        assistantErrorMessage("Operation aborted"),
      ],
      events: askEvents(sentinelResult),
    });
    (session as AgentSessionLike).abort = vi.fn(async () => {});

    const result = await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "m" }),
    });
    expect(result.content).toBe("asking…");
  });

  it("still persists the durable session on an asking turn", async () => {
    const session = makeFakeSession({
      messages: [assistantMessage("asking…")],
      events: askEvents(sentinelResult),
    });
    (session as AgentSessionLike).abort = vi.fn(async () => {});
    let persisted = 0;
    await runAgentLoop(baseArgs(), {
      openSession: async () => ({
        session,
        modelId: "m",
        durable: true,
        persistSession: async () => {
          persisted += 1;
        },
      }),
    });
    expect(persisted).toBe(1);
  });

  it("survives a session without an abort seam (optional on AgentSessionLike)", async () => {
    const session = makeFakeSession({
      messages: [assistantMessage("asking…")],
      events: askEvents(sentinelResult),
    });
    const result = await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "m" }),
    });
    expect(result.content).toBe("asking…");
    expect(result.toolInvocations[0].status).toBe("ok");
  });

  it("ignores the sentinel on an errored tool execution (no abort, failure handling intact)", async () => {
    const session = makeFakeSession({
      messages: [assistantErrorMessage("real model error")],
      events: askEvents(sentinelResult, true),
    });
    const abort = vi.fn(async () => {});
    (session as AgentSessionLike).abort = abort;

    await expect(
      runAgentLoop(baseArgs(), {
        openSession: async () => ({ session, modelId: "m" }),
      }),
    ).rejects.toThrow("real model error");
    expect(abort).not.toHaveBeenCalled();
  });

  it("ignores non-sentinel tool results (no abort)", async () => {
    const session = makeFakeSession({
      messages: [assistantMessage("done")],
      events: askEvents({
        content: [
          { type: "text", text: "Error: a question is already pending" },
        ],
        details: { thinkworkAskUserQuestion: { error: "already pending" } },
      }),
    });
    const abort = vi.fn(async () => {});
    (session as AgentSessionLike).abort = abort;

    const result = await runAgentLoop(baseArgs(), {
      openSession: async () => ({ session, modelId: "m" }),
    });
    expect(abort).not.toHaveBeenCalled();
    expect(result.content).toBe("done");
  });
});
