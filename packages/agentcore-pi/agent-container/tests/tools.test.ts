import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const awsSend = vi.hoisted(() => vi.fn());
const mcpListTools = vi.hoisted(() => vi.fn());
const mcpCallTool = vi.hoisted(() => vi.fn());
const mcpClose = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-bedrock-agentcore", () => {
  class BedrockAgentCoreClient {
    send = awsSend;
  }
  class StartCodeInterpreterSessionCommand {
    readonly input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class InvokeCodeInterpreterCommand {
    readonly input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class StopCodeInterpreterSessionCommand {
    readonly input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  return {
    BedrockAgentCoreClient,
    StartCodeInterpreterSessionCommand,
    InvokeCodeInterpreterCommand,
    StopCodeInterpreterSessionCommand,
  };
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    async connect() {
      return undefined;
    }
    listTools = mcpListTools;
    callTool = mcpCallTool;
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    close = mcpClose;
    constructor(
      readonly url: URL,
      readonly opts: unknown,
    ) {}
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class {
    close = mcpClose;
    constructor(
      readonly url: URL,
      readonly opts: unknown,
    ) {}
  },
}));

import { buildExecuteCodeTool } from "../src/runtime/tools/execute-code.js";
import {
  buildHindsightTools,
  retainHindsightTurn,
} from "../src/runtime/tools/hindsight.js";
import { buildMcpTools } from "../src/runtime/tools/mcp.js";
import { buildWebSearchTool } from "../src/runtime/tools/web-search.js";
import {
  buildWorkspaceSkillTool,
  discoverWorkspaceSkills,
} from "../src/runtime/tools/workspace-skills.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  awsSend.mockReset();
  mcpListTools.mockReset();
  mcpCallTool.mockReset();
  mcpClose.mockReset();
  mcpClose.mockResolvedValue(undefined);
  vi.restoreAllMocks();
});

describe("Pi runtime tools", () => {
  it("executes web_search through Exa and returns structured details", async () => {
    process.env.EXA_API_KEY = "exa-test-key";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "OpenAI News",
              url: "https://openai.com/news/",
              highlights: ["Latest updates from OpenAI."],
              score: 0.9,
            },
          ],
        }),
      ),
    );

    const tool = buildWebSearchTool({
      web_search_config: { provider: "exa", apiKey: "exa-test-key" },
    });
    expect(tool).not.toBeNull();

    const result = (await tool?.execute("tool-1", {
      query: "OpenAI news",
      num_results: 1,
    })) as { details: { provider: string; result_count: number } };

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.exa.ai/search",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.details.provider).toBe("exa");
    expect(result.details.result_count).toBe(1);
  });

  it("does not register web_search without tenant-resolved config", () => {
    expect(buildWebSearchTool({})).toBeNull();
  });

  it("returns no execute_code tool when sandbox preflight is absent", () => {
    expect(buildExecuteCodeTool({}, [])).toBeNull();
  });

  it("executes Python through AgentCore Code Interpreter and cleans up the session", async () => {
    awsSend
      .mockResolvedValueOnce({ sessionId: "session-1" })
      .mockResolvedValueOnce({
        stream: (async function* () {
          yield {
            result: {
              content: [{ text: "385" }],
              structuredContent: { stdout: "385", exitCode: 0 },
              isError: false,
            },
          };
        })(),
      })
      .mockResolvedValueOnce({});
    const cleanup: Array<() => Promise<void>> = [];
    const tool = buildExecuteCodeTool(
      { sandbox_interpreter_id: "interp-1", trace_id: "trace-1" },
      cleanup,
    );
    expect(tool).not.toBeNull();

    const result = (await tool?.execute("tool-2", {
      code: "print(sum(i*i for i in range(1, 11)))",
    })) as { details: { ok: boolean; stdout: string; session_id: string } };
    await cleanup[0]?.();

    expect(result.details).toMatchObject({
      ok: true,
      stdout: "385",
      session_id: "session-1",
    });
    expect(awsSend).toHaveBeenCalledTimes(3);
    expect(awsSend.mock.calls[2]?.[0].constructor.name).toBe(
      "StopCodeInterpreterSessionCommand",
    );
  });

  it("builds Hindsight tools from endpoint and records reflect usage", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          text: "Memory answer",
          usage: { model: "hindsight", input_tokens: 7, output_tokens: 3 },
        }),
      ),
    );
    const usage: Array<{
      phase: "retain" | "reflect";
      model: string;
      input_tokens: number;
      output_tokens: number;
    }> = [];

    const tools = buildHindsightTools(
      {
        hindsight_endpoint: "https://hindsight.test",
        user_id: "user-1",
      },
      usage,
    );
    const reflect = tools.find((tool) => tool.name === "hindsight_reflect");
    expect(reflect).toBeDefined();

    await reflect?.execute("tool-2", { query: "what do you know?" });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/v1/default/banks/user_user-1/reflect",
    );
    expect(usage).toEqual([
      {
        phase: "reflect",
        model: "hindsight",
        input_tokens: 7,
        output_tokens: 3,
      },
    ]);
  });

  it("does not register Hindsight tools without a user-scoped bank", () => {
    expect(
      buildHindsightTools(
        {
          hindsight_endpoint: "https://hindsight.test",
          assistant_id: "agent-1",
          instance_id: "agent-slug",
        },
        [],
      ),
    ).toEqual([]);
  });

  it("retains the end of a Pi turn in Hindsight memory", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({})));

    const result = await retainHindsightTurn(
      {
        use_memory: true,
        hindsight_endpoint: "https://hindsight.test/",
        thread_id: "thread-1",
        user_id: "user-1",
        message: "remember cobalt",
      },
      "I will remember cobalt.",
    );

    expect(result.retained).toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://hindsight.test/v1/default/banks/user_user-1/memories",
    );
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      items: [
        {
          document_id: "thread-1",
          metadata: { source: "thinkwork-pi", runtime: "pi" },
        },
      ],
    });
  });

  it("discovers and proxies configured MCP tools", async () => {
    mcpClose.mockResolvedValue(undefined);
    mcpListTools.mockResolvedValue({
      tools: [
        {
          name: "memory_read",
          description: "Read memory.",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      ],
    });
    mcpCallTool.mockResolvedValue({
      content: [{ type: "text", text: "remembered cobalt" }],
    });

    const cleanup: Array<() => Promise<void>> = [];
    const tools = await buildMcpTools(
      {
        mcp_configs: [
          {
            name: "user-memory",
            url: "https://mcp.test/user-memory",
            auth: { type: "bearer", token: "token-1" },
          },
        ],
      },
      cleanup,
    );
    expect(tools.map((tool) => tool.name)).toEqual([
      "mcp_user-memory_memory_read",
    ]);

    const result = (await tools[0]?.execute("tool-3", {
      query: "cobalt",
    })) as { details: { mcp_server: string; mcp_tool_name: string } };
    await cleanup[0]?.();

    expect(mcpCallTool).toHaveBeenCalledWith(
      {
        name: "memory_read",
        arguments: { query: "cobalt" },
      },
      undefined,
      { timeout: 60_000 },
    );
    expect(result.details).toMatchObject({
      mcp_server: "user-memory",
      mcp_tool_name: "memory_read",
    });
    expect(mcpClose).toHaveBeenCalled();
  });

  it("discovers workspace skills from the copied local tree", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tw-pi-skills-"));
    const skillDir = path.join(dir, "skills", "research");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: research",
        'description: "Research carefully"',
        "---",
        "",
        "Use primary sources.",
      ].join("\n"),
    );

    const skills = await discoverWorkspaceSkills(dir);

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      slug: "research",
      name: "research",
      description: "Research carefully",
    });
  });

  it("exposes a workspace_skill tool that returns the installed SKILL.md", async () => {
    const tool = buildWorkspaceSkillTool([
      {
        slug: "research",
        name: "research",
        description: "Research carefully",
        skillPath: "/tmp/workspace/skills/research/SKILL.md",
        content: "Use primary sources.",
      },
    ]);

    const result = await tool?.execute("tool-3", { slug: "research" });

    expect(result?.content[0]).toMatchObject({
      type: "text",
      text: "Use primary sources.",
    });
    expect(result?.details).toMatchObject({ slug: "research" });
  });
});
