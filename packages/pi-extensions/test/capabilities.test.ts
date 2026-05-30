import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { createBrowserAutomationExtension } from "../src/browser.js";
import { createContextEngineExtension } from "../src/context-engine.js";
import { createDelegationExtension } from "../src/delegation.js";
import { toExtensionFactory } from "../src/define-extension.js";
import { createSendEmailExtension } from "../src/send-email.js";
import { createSkillsExtension, formatWorkspaceSkills } from "../src/skills.js";
import { createWebSearchExtension } from "../src/web-search.js";

type FetchCall = [string | URL | Request, RequestInit?];

function makeFakeApi() {
  const tools: ToolDefinition[] = [];
  const api = {
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
    on: vi.fn(),
  } as unknown as ExtensionAPI;
  return { api, tools };
}

function getTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

const NO_SIGNAL = undefined;
const NO_UPDATE = undefined;
const NO_CTX = undefined as never;

describe("U7 capability extensions", () => {
  it("web_search gates on config and calls the configured provider", async () => {
    const empty = makeFakeApi();
    await toExtensionFactory(createWebSearchExtension({}), {})(empty.api);
    expect(empty.tools).toEqual([]);

    const fetchImpl = vi.fn(async () =>
      Response.json({
        results: [
          {
            title: "Result",
            url: "https://example.com",
            text: "summary",
          },
        ],
      }),
    );
    const { api, tools } = makeFakeApi();
    const extension = createWebSearchExtension({
      webSearchConfig: { provider: "exa", apiKey: "exa-key" },
      fetchImpl,
    });
    await toExtensionFactory(extension, {})(api);

    expect(extension.toolNames).toEqual(["web_search"]);
    const result = await getTool(tools, "web_search").execute(
      "call-1",
      { query: "current pi docs", num_results: 1 },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.exa.ai/search",
      expect.objectContaining({ method: "POST" }),
    );
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toContain("https://example.com");
  });

  it("send_email registers only when configured and preserves current-user recipient resolution", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ messageId: "email-1" }),
    );
    const { api, tools } = makeFakeApi();
    const extension = createSendEmailExtension({
      sendEmailConfig: {
        apiUrl: "https://api.example.com/",
        apiSecret: "secret",
        agentId: "agent-1",
        tenantId: "tenant-1",
        threadId: "thread-1",
      },
      payload: {
        current_user_email: "eric@example.com",
        tenant_slug: "acme",
        turn_context: { spaceSlug: "finance" },
      },
      fetchImpl,
    });
    await toExtensionFactory(extension, {})(api);

    expect(extension.toolNames).toEqual(["send_email"]);
    const result = await getTool(tools, "send_email").execute(
      "call-1",
      { to: "me", subject: "Hello", body: "Body" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    const fetchCalls = fetchImpl.mock.calls as unknown as FetchCall[];
    const [, init] = fetchCalls[0]!;
    expect(fetchCalls[0]![0]).toBe("https://api.example.com/api/email/send");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      to: "eric@example.com",
      subject: "Hello",
      body: "Body",
      spaceTenantSlug: "acme",
      spaceSlug: "finance",
      threadId: "thread-1",
    });
    expect((result.content?.[0] as { text: string }).text).toContain(
      "Email sent",
    );
  });

  it("context-engine registers all query tools and calls the MCP facade", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        result: {
          content: [{ type: "text", text: "company brain result" }],
        },
      }),
    );
    const { api, tools } = makeFakeApi();
    const extension = createContextEngineExtension({
      enabled: true,
      apiUrl: "https://api.example.com",
      apiSecret: "secret",
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "agent-1",
      contextEngineConfig: { providers: { families: ["wiki"] } },
      fetchImpl,
    });
    await toExtensionFactory(extension, {})(api);

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "query_context",
      "query_memory_context",
      "query_wiki_context",
    ]);

    const result = await getTool(tools, "query_context").execute(
      "call-1",
      { query: "who is acme" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    const fetchCalls = fetchImpl.mock.calls as unknown as FetchCall[];
    const body = JSON.parse(String(fetchCalls[0]![1]?.body));
    expect(body).toMatchObject({
      method: "tools/call",
      params: {
        name: "query_context",
        arguments: { query: "who is acme", providers: { families: ["wiki"] } },
      },
    });
    expect((result.content?.[0] as { text: string }).text).toBe(
      "company brain result",
    );
  });

  it("browser_automation delegates execution to the host runner", async () => {
    const run = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "browser result" }],
      details: { ok: true },
    }));
    const { api, tools } = makeFakeApi();
    const extension = createBrowserAutomationExtension({
      enabled: true,
      run,
    });
    await toExtensionFactory(extension, {})(api);

    await getTool(tools, "browser_automation").execute(
      "call-1",
      { url: "https://example.com", task: "inspect" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    expect(run).toHaveBeenCalledWith(
      { url: "https://example.com", task: "inspect" },
      undefined,
    );
  });

  it("delegation calls only the DelegationProvider seam", async () => {
    const delegate = vi.fn(async () => ({
      ok: true,
      delegationId: "delegation-1",
      parentThreadTurnId: "turn-1",
      childThreadTurnId: "turn-2",
      requestedVisibility: "hidden" as const,
      effectiveVisibility: "hidden" as const,
      status: "completed" as const,
    }));
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(createDelegationExtension(), {
      delegation: { delegate },
    })(api);

    const result = await getTool(tools, "delegate_to_managed_agent").execute(
      "call-1",
      { task: "summarize", visibility: "hidden", reason: "helper" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    expect(delegate).toHaveBeenCalledWith({
      task: "summarize",
      visibility: "hidden",
      reason: "helper",
      timeoutMs: undefined,
    });
    expect((result.content?.[0] as { text: string }).text).toContain(
      "delegation-1",
    );
  });

  it("delegation fails loud when enabled without a provider", () => {
    const { api } = makeFakeApi();
    expect(() =>
      toExtensionFactory(createDelegationExtension(), {})(api),
    ).toThrow(/requires a "delegation" provider/);
  });

  it("workspace skills register a reader tool and preserve prompt formatting", async () => {
    const skills = [
      {
        slug: "research",
        name: "Research",
        description: "Deep research helper",
        skillPath: "/workspace/skills/research/SKILL.md",
        content: "# Research\nUse carefully.",
      },
    ];
    const { api, tools } = makeFakeApi();
    const extension = createSkillsExtension({ skills });
    await toExtensionFactory(extension, {})(api);

    expect(formatWorkspaceSkills(skills)).toContain(
      "- research: Deep research helper",
    );
    expect(extension.toolNames).toEqual(["workspace_skill"]);
    const result = await getTool(tools, "workspace_skill").execute(
      "call-1",
      { slug: "research" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    expect((result.content?.[0] as { text: string }).text).toContain(
      "# Research",
    );
  });
});
