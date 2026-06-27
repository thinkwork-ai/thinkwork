import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createCrmOpportunityValueByOwnerFixture } from "@thinkwork/analytics-display";
import { describe, expect, it, vi } from "vitest";

import { createAnalyticsDisplayExtension } from "../src/analytics-display.js";
import { createBrowserAutomationExtension } from "../src/browser.js";
import { createContextEngineExtension } from "../src/context-engine.js";
import { createDelegationExtension } from "../src/delegation.js";
import { toExtensionFactory } from "../src/define-extension.js";
import { createSendEmailExtension } from "../src/send-email.js";
import { createSkillsExtension, formatWorkspaceSkills } from "../src/skills.js";
import { createTaskStatusExtension } from "../src/task-status.js";
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
  it("show_analytics_display returns Thread GenUI for a valid analytics payload", async () => {
    const { api, tools } = makeFakeApi();
    const extension = createAnalyticsDisplayExtension();
    await toExtensionFactory(extension, {})(api);

    expect(extension.toolNames).toEqual(["show_analytics_display"]);
    const result = await getTool(tools, "show_analytics_display").execute(
      "call-1",
      {
        id: "genui:analytics:crm-owner-value",
        payload: createCrmOpportunityValueByOwnerFixture(),
        artifactTitle: "Opportunity value by owner",
      },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    expect((result.content?.[0] as { text: string }).text).toContain(
      "Opportunity Value by Owner",
    );
    expect((result.details as any).threadGenUI).toMatchObject({
      type: "data-genui",
      id: "genui:analytics:crm-owner-value",
      data: {
        schemaVersion: "thread-genui/v1",
        catalogVersion: "thread-genui-catalog/v1",
        spec: {
          elements: {
            analytics: {
              component: "analytics.display",
            },
          },
        },
      },
    });
  });

  it("show_analytics_display normalizes common LLM chart payload variants", async () => {
    const { api, tools } = makeFakeApi();
    const extension = createAnalyticsDisplayExtension();
    await toExtensionFactory(extension, {})(api);

    const result = await getTool(tools, "show_analytics_display").execute(
      "call-1",
      {
        payload: {
          kind: "analytics.display",
          analyticsDisplayVersion: "analytics-display/v1",
          provenance: {
            sourceLabels: ["Twenty CRM", "Opportunity Export"],
          },
          freshness: {
            takenAt: "2026-06-21T12:50:00Z",
          },
          sensitivity: {
            containsSensitiveFields: false,
            level: "internal",
          },
          spec: {
            title: "Open Opportunity Value by Owner",
            columns: [
              { key: "owner", name: "Owner", type: "string" },
              {
                key: "open_value",
                name: "Open Value",
                type: "number",
                format: "currency",
              },
              {
                key: "opportunity_count",
                name: "Opportunities",
                type: "number",
              },
            ],
            elements: [
              {
                id: "bar-chart-1",
                type: "chart",
                chartType: "bar",
                title: "Open Opportunity Value by Owner",
                xAxis: { key: "owner", label: "Owner" },
                yAxis: {
                  key: "open_value",
                  label: "Open Value",
                  format: "currency",
                },
              },
              {
                id: "table-1",
                type: "table",
                compact: true,
                columns: ["owner", "open_value", "opportunity_count"],
              },
            ],
          },
          data: {
            rows: [
              { owner: "Maya Chen", open_value: 184000, opportunity_count: 7 },
              {
                owner: "Owen Brooks",
                open_value: 139500,
                opportunity_count: 5,
              },
              { owner: "Priya Shah", open_value: 118250, opportunity_count: 4 },
              {
                owner: "Luis Romero",
                open_value: 86500,
                opportunity_count: 3,
              },
            ],
          },
        },
      },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    expect((result.content?.[0] as { text: string }).text).toContain(
      "Open Opportunity Value by Owner",
    );
    const analyticsProps = (result.details as any).threadGenUI.data.spec
      .elements.analytics.props;
    expect(analyticsProps.spec.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "open_value", label: "Open Value" }),
      ]),
    );
    expect(analyticsProps.spec.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "chart",
          chartKind: "bar",
          categoryKey: "owner",
          series: [
            expect.objectContaining({
              valueKey: "open_value",
              palette: "chart-1",
            }),
          ],
        }),
        expect.objectContaining({
          type: "table",
          columns: [
            { key: "owner", label: "Owner" },
            { key: "open_value", label: "Open Value" },
            { key: "opportunity_count", label: "Opportunities" },
          ],
        }),
      ]),
    );
  });

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
    expect(getTool(tools, "web_search").description).toContain("web_extract");
    expect(getTool(tools, "web_search").description).toContain(
      "candidate URLs",
    );
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

  it("send_email can carry a desktop thread-turn auth header", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ok: true }));
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(
      createSendEmailExtension({
        sendEmailConfig: {
          apiUrl: "https://api.example.com",
          apiSecret: "desktop-token",
          agentId: "agent-1",
          tenantId: "tenant-1",
          threadTurnId: "turn-1",
        },
        payload: {
          current_user_email: "eric@example.com",
          tenant_slug: "acme",
          turn_context: { spaceSlug: "finance" },
        },
        fetchImpl,
      }),
      {},
    )(api);

    await getTool(tools, "send_email").execute(
      "call-1",
      { to: "me", subject: "Hello", body: "Body" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    const fetchCalls = fetchImpl.mock.calls as unknown as FetchCall[];
    expect(fetchCalls[0]![1]?.headers).toMatchObject({
      Authorization: "Bearer desktop-token",
      "x-thread-turn-id": "turn-1",
    });
  });

  it("send_email reports pending human review without claiming delivery", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        status: "pending_review",
        conversationId: "conversation-1",
        inboxItemId: "inbox-1",
      }),
    );
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(
      createSendEmailExtension({
        sendEmailConfig: {
          apiUrl: "https://api.example.com",
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
      }),
      {},
    )(api);

    const result = await getTool(tools, "send_email").execute(
      "call-1",
      { to: "me", subject: "Hello", body: "Body" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    expect((result.content?.[0] as { text: string }).text).toContain(
      "pending human review",
    );
    expect(result.details).toMatchObject({
      ok: false,
      status: "pending_review",
      conversationId: "conversation-1",
      inboxItemId: "inbox-1",
    });
  });

  it("task status tools register when configured and post database mutation requests", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        content: [{ type: "text", text: '{"ok":true}' }],
        details: { ok: true, status: "completed" },
      }),
    );
    const { api, tools } = makeFakeApi();
    const extension = createTaskStatusExtension({
      taskStatusConfig: {
        apiUrl: "https://api.example.com/",
        apiSecret: "secret",
        tenantId: "tenant-1",
        agentId: "agent-1",
        threadId: "thread-1",
        threadTurnId: "turn-1",
      },
      fetchImpl,
    });
    await toExtensionFactory(extension, {})(api);

    expect(extension.toolNames).toEqual([
      "set_task_status",
      "set_work_item_status",
    ]);
    const result = await getTool(tools, "set_task_status").execute(
      "call-1",
      {
        linked_task_id: "task-1",
        status: "completed",
        note: "Customer confirmed.",
      },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    const fetchCalls = fetchImpl.mock.calls as unknown as FetchCall[];
    expect(fetchCalls[0]![0]).toBe("https://api.example.com/api/tasks/status");
    expect(fetchCalls[0]![1]?.headers).toMatchObject({
      Authorization: "Bearer secret",
      "x-agent-id": "agent-1",
      "x-thread-turn-id": "turn-1",
      "x-tenant-id": "tenant-1",
    });
    expect(JSON.parse(String(fetchCalls[0]![1]?.body))).toMatchObject({
      tenantId: "tenant-1",
      agentId: "agent-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      linkedTaskId: "task-1",
      status: "completed",
      note: "Customer confirmed.",
    });
    expect(result.details).toEqual({ ok: true, status: "completed" });

    await getTool(tools, "set_work_item_status").execute(
      "call-2",
      {
        work_item_id: "work-item-1",
        status_category: "done",
        note: "Native item confirmed.",
      },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    expect(fetchCalls[1]![0]).toBe(
      "https://api.example.com/api/work-items/status",
    );
    expect(JSON.parse(String(fetchCalls[1]![1]?.body))).toMatchObject({
      tenantId: "tenant-1",
      agentId: "agent-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      toolCallId: "call-2",
      workItemId: "work-item-1",
      statusCategory: "done",
      note: "Native item confirmed.",
    });
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
      "query_brain_context",
      "query_context",
      "query_memory_context",
      "query_wiki_context",
    ]);
    expect(getTool(tools, "query_context").description).toContain(
      "current-space long-term memory",
    );
    expect(getTool(tools, "query_context").description).not.toContain(
      "knowledge bases",
    );
    expect(getTool(tools, "query_memory_context").description).toContain(
      'scope "team"',
    );
    expect(getTool(tools, "query_memory_context").description).toContain(
      "identity is closed over by the host",
    );

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

    await getTool(tools, "query_memory_context").execute(
      "call-2",
      { query: "space decision", scope: "team" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );
    const memoryBody = JSON.parse(String(fetchCalls[1]![1]?.body));
    expect(memoryBody).toMatchObject({
      method: "tools/call",
      params: {
        name: "query_memory_context",
        arguments: { query: "space decision", scope: "team" },
      },
    });
  });

  it("context-engine forwards Brain-specific query and detail arguments", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        result: {
          content: [{ type: "text", text: "brain shortlist" }],
        },
      }),
    );
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(
      createContextEngineExtension({
        enabled: true,
        apiUrl: "https://api.example.com",
        apiSecret: "secret",
        tenantId: "tenant-1",
        userId: "user-1",
        agentId: "agent-1",
        fetchImpl,
      }),
      {},
    )(api);

    const tool = getTool(tools, "query_brain_context");
    expect(tool.description).toContain("tenant-shared ThinkWork Brain");
    expect(tool.description).toContain("query_memory_context");
    expect(tool.description).toContain("detailIds");

    const result = await tool.execute(
      "call-1",
      {
        query: "Acme renewal",
        mode: "answer",
        scope: "team",
        depth: "deep",
        limit: 5,
        sourceKind: "thread",
        sourceType: "thread_message",
        datasetId: "dogfood-renewal",
        nodeSetIds: ["customer-success"],
        topK: 7,
        onlyContext: true,
        detailIds: ["brain:acme"],
        detailIndexes: [2],
      },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    const fetchCalls = fetchImpl.mock.calls as unknown as FetchCall[];
    const body = JSON.parse(String(fetchCalls[0]![1]?.body));
    expect(body).toMatchObject({
      method: "tools/call",
      params: {
        name: "query_brain_context",
        arguments: {
          query: "Acme renewal",
          mode: "answer",
          scope: "team",
          depth: "deep",
          limit: 5,
          sourceKind: "thread",
          sourceType: "thread_message",
          datasetId: "dogfood-renewal",
          nodeSetIds: ["customer-success"],
          topK: 7,
          onlyContext: true,
          detailIds: ["brain:acme"],
          detailIndexes: [2],
        },
      },
    });
    expect((result.content?.[0] as { text: string }).text).toBe(
      "brain shortlist",
    );
  });

  it("context-engine adds structured wiki context metadata to wiki lookup results", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        result: {
          content: [{ type: "text", text: "1. [wiki] Acme Renewal" }],
          structuredContent: {
            query: "Acme renewal",
            mode: "results",
            scope: "auto",
            depth: "quick",
            hits: [
              {
                id: "wiki:page-1",
                title: "Acme Renewal",
                family: "wiki",
                score: 0.92,
                scope: "auto",
                metadata: {
                  page: {
                    id: "page-1",
                    slug: "acme-renewal",
                    type: "entity",
                  },
                },
              },
            ],
            providers: [
              {
                providerId: "wiki",
                displayName: "ThinkWork Brain Pages",
                state: "ok",
                hitCount: 1,
                durationMs: 12,
              },
            ],
          },
        },
      }),
    );
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(
      createContextEngineExtension({
        enabled: true,
        apiUrl: "https://api.example.com",
        apiSecret: "secret",
        tenantId: "tenant-1",
        userId: "user-1",
        agentId: "agent-1",
        fetchImpl,
      }),
      {},
    )(api);

    const result = await getTool(tools, "query_wiki_context").execute(
      "call-1",
      { query: "Acme renewal", limit: 3 },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    expect((result.details as any).wiki_context).toMatchObject({
      surface: "query_wiki_context",
      retrieval_mode: "db",
      query: "Acme renewal",
      result_count: 1,
      answered_from_db: true,
      top_pages: [
        {
          id: "page-1",
          context_id: "wiki:page-1",
          title: "Acme Renewal",
          slug: "acme-renewal",
          type: "entity",
        },
      ],
      provider_states: [
        {
          provider_id: "wiki",
          state: "ok",
          hit_count: 1,
          duration_ms: 12,
        },
      ],
    });
  });

  it("context-engine keeps disabled and empty Brain query behavior explicit", async () => {
    const disabled = makeFakeApi();
    const disabledExtension = createContextEngineExtension({
      enabled: false,
      apiUrl: "https://api.example.com",
      apiSecret: "secret",
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "agent-1",
    });
    await toExtensionFactory(disabledExtension, {})(disabled.api);
    expect(disabledExtension.toolNames).toEqual([]);
    expect(disabled.tools).toEqual([]);

    const fetchImpl = vi.fn(async () => Response.json({ result: {} }));
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(
      createContextEngineExtension({
        enabled: true,
        apiUrl: "https://api.example.com",
        apiSecret: "secret",
        tenantId: "tenant-1",
        userId: "user-1",
        agentId: "agent-1",
        fetchImpl,
      }),
      {},
    )(api);

    const result = await getTool(tools, "query_brain_context").execute(
      "call-1",
      { query: "   " },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect((result.content?.[0] as { text: string }).text).toBe(
      "query_brain_context requires a non-empty query.",
    );
  });

  it("context-engine can authorize with a desktop thread-turn token", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        result: { content: [{ type: "text", text: "desktop context" }] },
      }),
    );
    const { api, tools } = makeFakeApi();
    await toExtensionFactory(
      createContextEngineExtension({
        enabled: true,
        apiUrl: "https://api.example.com",
        apiSecret: "desktop-token",
        tenantId: "tenant-1",
        userId: "user-1",
        agentId: "agent-1",
        threadTurnId: "turn-1",
        fetchImpl,
      }),
      {},
    )(api);

    await getTool(tools, "query_context").execute(
      "call-1",
      { query: "desktop context" },
      NO_SIGNAL,
      NO_UPDATE,
      NO_CTX,
    );

    const fetchCalls = fetchImpl.mock.calls as unknown as FetchCall[];
    expect(fetchCalls[0]![1]?.headers).toMatchObject({
      authorization: "Bearer desktop-token",
      "x-thread-turn-id": "turn-1",
    });
    expect(fetchCalls[0]![1]?.headers).not.toMatchObject({
      "x-user-id": "user-1",
    });
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

    expect(getTool(tools, "browser_automation").description).toContain(
      "`web_extract`",
    );
    expect(getTool(tools, "browser_automation").description).toContain(
      "Only reach for `browser_automation`",
    );
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
