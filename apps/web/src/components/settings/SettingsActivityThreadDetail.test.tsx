import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuery, useSubscription } from "urql";
import {
  ComputerThreadQuery,
  SettingsActivityThreadTracesQuery,
  SettingsActivityThreadTurnsQuery,
} from "@/lib/graphql-queries";
import { SettingsTenantModelCatalogQuery } from "@/lib/settings-queries";

const usePageHeaderActionsMock = vi.hoisted(() => vi.fn());

vi.mock("urql", () => ({
  useQuery: vi.fn(),
  useSubscription: vi.fn(),
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: usePageHeaderActionsMock,
}));

vi.mock("@/components/SystemPromptSheet", () => ({
  SystemPromptSheet: ({
    capturedSystemPrompt,
  }: {
    capturedSystemPrompt?: string | null;
  }) => (
    <div data-testid="system-prompt-sheet">
      {capturedSystemPrompt ? "System prompt ready" : "No prompt"}
    </div>
  ),
}));

vi.mock("@thinkwork/ui", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  Badge: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLSpanElement> & { variant?: string }) => (
    <span {...props}>{children}</span>
  ),
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
  }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Collapsible: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CollapsibleTrigger: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Dialog: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Separator: (props: React.HTMLAttributes<HTMLHRElement>) => <hr {...props} />,
}));

import { SettingsActivityThreadDetail } from "./SettingsActivityThreadDetail";

const thread = {
  id: "thread-1",
  identifier: "CHAT-1043",
  title: "what is SpaceX",
  status: "DONE",
  channel: "chat",
  spaceId: "space-1",
  space: { id: "space-1", name: "Default", slug: "default" },
  costSummary: 0.0741,
  createdAt: "2026-06-04T16:55:00.000Z",
  updatedAt: "2026-06-05T00:00:00.000Z",
  messages: {
    edges: [
      {
        node: {
          id: "message-1",
          role: "USER",
          content: "what is SpaceX",
          createdAt: "2026-06-04T16:55:00.000Z",
          sender: { displayName: "Eric Odom" },
        },
      },
      {
        node: {
          id: "message-2",
          role: "ASSISTANT",
          content: "SpaceX is an American aerospace manufacturer.",
          createdAt: "2026-06-04T16:55:10.000Z",
        },
      },
    ],
  },
};

const turn = {
  id: "turn-1",
  invocationSource: "chat",
  triggerName: "Manual chat",
  turnNumber: 1,
  runtimeType: "pi",
  status: "succeeded",
  startedAt: "2026-06-04T16:55:01.000Z",
  finishedAt: "2026-06-04T16:55:09.300Z",
  usageJson: JSON.stringify({
    input_tokens: 5500,
    output_tokens: 269,
    tool_invocations: [
      {
        tool_name: "web_search",
        type: "tool",
        input_preview: '{"query":"SpaceX"}',
        output_preview: "Search results",
        model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        input_tokens: 1234,
        output_tokens: 34,
        cached_read_tokens: 12,
        model_routing_status: "succeeded",
        model_routing_rule_source: {
          scope: "space",
          path: "spaces/sales/TOOLS.md",
        },
        model_routing_match: {
          tool: "web_search",
        },
      },
    ],
  }),
  totalCost: 0.0076,
  systemPrompt: "You are Pi.",
  createdAt: "2026-06-04T16:55:01.000Z",
};

function mockActivityQueries(options?: {
  thread?: typeof thread;
  turn?: typeof turn;
  traces?: Array<Record<string, unknown>>;
  models?: Array<Record<string, unknown>>;
  bridgeRuns?: Array<Record<string, unknown>>;
}) {
  const activeThread = options?.thread ?? thread;
  const activeTurn = options?.turn ?? turn;
  const models = options?.models ?? [
    {
      id: "model-haiku",
      modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      displayName: "Claude Haiku 4.5",
      provider: "Anthropic",
    },
    {
      id: "model-sonnet",
      modelId: "us.anthropic.claude-sonnet-4-6",
      displayName: "Sonnet 4.6",
      provider: "Anthropic",
    },
    {
      id: "model-kimi",
      modelId: "moonshotai.kimi-k2.5",
      displayName: "Kimi K2.5",
      provider: "Moonshot",
    },
  ];
  const traces = options?.traces ?? [
    {
      traceId: "trace-1",
      agentName: "Pi",
      runtimeType: "pi",
      model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      inputTokens: 5500,
      outputTokens: 269,
      durationMs: 8300,
      costUsd: 0.0076,
      createdAt: "2026-06-04T16:55:09.300Z",
    },
    {
      traceId: "trace-tool-1",
      parentRequestId: "turn-1",
      toolCallId: "tool-call-1",
      toolName: "web_search",
      agentName: "Pi",
      runtimeType: "pi",
      model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      inputTokens: 1234,
      outputTokens: 34,
      costUsd: 0.0012,
      modelRoutingStatus: "succeeded",
      ruleSource: {
        scope: "space",
        path: "spaces/sales/TOOLS.md",
      },
      match: {
        tool: "web_search",
      },
      createdAt: "2026-06-04T16:55:08.000Z",
    },
  ];
  const bridgeRuns = options?.bridgeRuns ?? [];
  vi.mocked(useQuery).mockImplementation(({ query }: { query: unknown }) => {
    if (query === ComputerThreadQuery) {
      return [
        {
          data: { thread: activeThread, n8nAgentStepRuns: bridgeRuns },
          fetching: false,
          error: undefined,
          stale: false,
          hasNext: false,
        },
        vi.fn(),
      ];
    }
    if (query === SettingsActivityThreadTurnsQuery) {
      return [
        {
          data: { threadTurns: [activeTurn] },
          fetching: false,
          error: undefined,
          stale: false,
          hasNext: false,
        },
        vi.fn(),
      ];
    }
    if (query === SettingsActivityThreadTracesQuery) {
      return [
        {
          data: { threadTraces: traces },
          fetching: false,
          error: undefined,
          stale: false,
          hasNext: false,
        },
        vi.fn(),
      ];
    }
    if (query === SettingsTenantModelCatalogQuery) {
      return [
        {
          data: { tenantModelCatalog: models },
          fetching: false,
          error: undefined,
          stale: false,
          hasNext: false,
        },
        vi.fn(),
      ];
    }
    return [
      {
        data: {},
        fetching: false,
        error: undefined,
        stale: false,
        hasNext: false,
      },
      vi.fn(),
    ];
  });
}

beforeEach(() => {
  usePageHeaderActionsMock.mockReset();
  vi.mocked(useQuery).mockReset();
  vi.mocked(useSubscription).mockReset();
  mockActivityQueries();
  vi.mocked(useSubscription).mockReturnValue([
    { data: null, fetching: false, stale: false },
    vi.fn(),
  ]);
});

afterEach(() => cleanup());

describe("SettingsActivityThreadDetail", () => {
  it("renders the admin-style thread detail instead of the chat composer", () => {
    render(
      <SettingsActivityThreadDetail
        threadId="thread-1"
        breadcrumbParents={[{ label: "Activity", href: "/settings/activity" }]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "what is SpaceX" }),
    ).toBeTruthy();
    expect(screen.getByText("CHAT-1043")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "CHAT-1043" })).toBeTruthy();
    expect(screen.queryByText("Properties")).toBeNull();
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.getByText("Tool: web_search")).toBeTruthy();
    expect(screen.getByText("Claude Haiku 4.5")).toBeTruthy();
    expect(screen.getByText(/1\.2K->34/)).toBeTruthy();
    expect(screen.getByText("$0.0012")).toBeTruthy();
    expect(screen.queryByText("succeeded")).toBeNull();
    expect(screen.queryByText(/not routed/i)).toBeNull();
    expect(screen.queryByText(/tokens unavailable/i)).toBeNull();
    expect(screen.getByText("Eric Odom")).toBeTruthy();
    expect(screen.getByText("ThinkWork")).toBeTruthy();
    expect(screen.queryByText(/Type a command/i)).toBeNull();

    const headerArgs = usePageHeaderActionsMock.mock.calls.at(-1)?.[0];
    expect(headerArgs.breadcrumbs).toEqual([
      { label: "Activity", href: "/settings/activity" },
      { label: "what is SpaceX" },
    ]);
    expect(headerArgs.actionKey).toBe("thread-actions-trace-props-closed");

    render(headerArgs.action);
    mockActivityQueries();
    // The thread workspace (files) button now lives in the operator header.
    expect(
      screen.getByRole("button", { name: "Open thread files" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Open thread properties" }),
    );
    expect(screen.getByText("Properties")).toBeTruthy();
  });

  it("renders bridge evidence in the properties panel when a run exists", () => {
    vi.mocked(useQuery).mockReset();
    mockActivityQueries({
      bridgeRuns: [
        {
          id: "run-1",
          status: "waiting",
          resumeStatus: "not_ready",
          workflowId: "workflow-1",
          workflowName: "Invoice approval",
          executionId: "exec-1",
          correlationId: "corr-1",
          instructionsPreview: "Check invoice status",
          inputPreview: null,
          outputPreview: null,
          errorMessage: null,
          summary: null,
          links: {},
          resumeAttemptCount: 0,
          lastResumeHttpStatus: null,
          lastResumeError: null,
          expiresAt: "2026-06-20T12:30:00.000Z",
          updatedAt: "2026-06-20T12:00:00.000Z",
        },
      ],
    });

    render(
      <SettingsActivityThreadDetail
        threadId="thread-1"
        breadcrumbParents={[{ label: "Activity", href: "/settings/activity" }]}
      />,
    );

    const headerArgs = usePageHeaderActionsMock.mock.calls.at(-1)?.[0];
    render(headerArgs.action);
    fireEvent.click(
      screen.getByRole("button", { name: "Open thread properties" }),
    );

    expect(screen.getByText("n8n agent steps")).toBeTruthy();
    expect(screen.getByText("Invoice approval")).toBeTruthy();
    expect(screen.getByText("waiting")).toBeTruthy();
    expect(screen.getByText("Check invoice status")).toBeTruthy();
  });

  it("uses shortcut display text for the Activity breadcrumb and document title", () => {
    vi.mocked(useQuery).mockReset();
    mockActivityQueries({
      thread: {
        ...thread,
        title: "#Research verify agent profile e2e",
      },
    });

    render(
      <SettingsActivityThreadDetail
        threadId="thread-1"
        breadcrumbParents={[{ label: "Activity", href: "/settings/activity" }]}
      />,
    );

    const headerArgs = usePageHeaderActionsMock.mock.calls.at(-1)?.[0];
    expect(headerArgs.documentTitle).toBe(
      "Activity Thread · Research verify agent profile e2e",
    );
    expect(headerArgs.breadcrumbs).toEqual([
      { label: "Activity", href: "/settings/activity" },
      { label: "Research verify agent profile e2e" },
    ]);
    expect(
      screen.getByRole("heading", {
        name: "Research verify agent profile e2e",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("#Research verify agent profile e2e")).toBeNull();
  });

  it("uses the full first user message when the stored title is clipped", () => {
    vi.mocked(useQuery).mockReset();
    mockActivityQueries({
      thread: {
        ...thread,
        title: "#Research explicit profile e2e: find the current ceo...",
        messages: {
          edges: [
            {
              node: {
                id: "message-1",
                role: "USER",
                content:
                  "#Research explicit profile e2e: find the current ceo of stripe today, cite one source, one sentence.",
                createdAt: "2026-06-04T16:55:00.000Z",
                sender: { displayName: "Eric Odom" },
              },
            },
          ],
        },
      },
    });

    render(
      <SettingsActivityThreadDetail
        threadId="thread-1"
        breadcrumbParents={[{ label: "Activity", href: "/settings/activity" }]}
      />,
    );

    const fullDisplayTitle =
      "Research explicit profile e2e: find the current ceo of stripe today, cite one source, one sentence.";
    const headerArgs = usePageHeaderActionsMock.mock.calls.at(-1)?.[0];
    expect(headerArgs.documentTitle).toBe(
      `Activity Thread · ${fullDisplayTitle}`,
    );
    expect(headerArgs.breadcrumbs).toEqual([
      { label: "Activity", href: "/settings/activity" },
      { label: fullDisplayTitle },
    ]);
    expect(
      screen.getByRole("heading", { name: fullDisplayTitle }).className,
    ).toContain("[text-wrap:wrap]");
    expect(
      screen.queryByText(
        "#Research explicit profile e2e: find the current ceo...",
      ),
    ).toBeNull();
  });

  it("renders parent composer model evidence for non-overridden tool calls", () => {
    const fallbackTurn = {
      ...turn,
      usageJson: JSON.stringify({
        model: "us.anthropic.claude-sonnet-4-6",
        input_tokens: 12,
        output_tokens: 417,
        cached_read_tokens: 17500,
        tool_invocations: [
          {
            id: "web-search-1",
            tool_name: "web_search",
            type: "tool",
            input_preview: '{"query":"Stripe CEO"}',
            output_preview: "Search results",
            model: "moonshotai.kimi-k2.5",
            input_tokens: 6,
            output_tokens: 209,
            cached_read_tokens: 8750,
            cost_usd: 0.0043995,
            model_routing_status: "parent_model",
            model_routing_match: {
              tool: "web_search",
              fallback: "composer_model",
            },
          },
          {
            id: "web-extract-1",
            tool_name: "web_extract",
            type: "tool",
            input_preview: '{"url":"https://stripe.com"}',
            output_preview: "Extracted page",
            model: "moonshotai.kimi-k2.5",
            input_tokens: 6,
            output_tokens: 208,
            cached_read_tokens: 8750,
            cost_usd: 0.0043995,
            model_routing_status: "parent_model",
            model_routing_match: {
              tool: "web_extract",
              fallback: "composer_model",
            },
          },
        ],
      }),
      totalCost: 0.008799,
    };
    vi.mocked(useQuery).mockReset();
    mockActivityQueries({ turn: fallbackTurn, traces: [] });

    render(
      <SettingsActivityThreadDetail
        threadId="thread-1"
        breadcrumbParents={[{ label: "Activity", href: "/settings/activity" }]}
      />,
    );

    expect(screen.getByText("Tool: web_search")).toBeTruthy();
    expect(screen.getByText("Tool: web_extract")).toBeTruthy();
    expect(screen.getAllByText("Kimi K2.5").length).toBeGreaterThan(0);
    expect(screen.getByText("6->209 (8.8K cached)")).toBeTruthy();
    expect(screen.getByText("6->208 (8.8K cached)")).toBeTruthy();
    expect(screen.getAllByText("$0.0044")).toHaveLength(2);
    expect(screen.queryByText("parent model")).toBeNull();
    expect(screen.queryByText(/not routed/i)).toBeNull();
    expect(screen.queryByText(/tokens unavailable/i)).toBeNull();
  });

  it("renders MCP route evidence from usage_json model_routed_tool_calls", () => {
    const mcpTurn = {
      ...turn,
      usageJson: JSON.stringify({
        input_tokens: 12,
        output_tokens: 727,
        tool_invocations: [
          {
            id: "mcp-call-1",
            tool_name: "mcp_twenty-crm_execute_tool",
            type: "mcp_tool",
            input_preview: '{"name":"find_many_opportunities"}',
            output_preview: "Found opportunities",
          },
        ],
        model_routed_tool_calls: [
          {
            toolCallId: "mcp-call-1",
            toolName: "mcp_twenty-crm_execute_tool",
            model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            inputTokens: 91,
            outputTokens: 13,
            cachedReadTokens: 7,
            costUsd: 0.0004,
            status: "completed",
            ruleSource: {
              owner: "workspace",
              path: "TOOLS.md",
            },
            match: {
              serverName: "twenty-crm",
              tool: "mcp_twenty-crm_execute_tool",
            },
          },
        ],
      }),
    };
    vi.mocked(useQuery).mockReset();
    mockActivityQueries({ turn: mcpTurn, traces: [] });

    render(
      <SettingsActivityThreadDetail
        threadId="thread-1"
        breadcrumbParents={[{ label: "Activity", href: "/settings/activity" }]}
      />,
    );

    expect(screen.getByText("Tool: mcp_twenty-crm_execute_tool")).toBeTruthy();
    expect(screen.getByText("Claude Haiku 4.5")).toBeTruthy();
    expect(screen.getByText("91->13 (7 cached)")).toBeTruthy();
    expect(screen.getByText("$0.0004")).toBeTruthy();
    expect(screen.queryByText("completed")).toBeNull();
  });

  it("renders operator goal-run status from persisted turn evidence", () => {
    const goalTurn = {
      ...turn,
      resultJson: JSON.stringify({
        response: "Paused at budget.",
        goal_run: {
          source: "pi_goal",
          status: "budget_limited",
          objective: "Prepare launch report",
          completion_summary: "Drafted two sections.",
          token_budget: 125000,
          tokens_used: 125001,
          budget_limited_reason: "Tenant goal budget reached.",
          resume_eligible: true,
        },
      }),
    };
    vi.mocked(useQuery).mockReset();
    mockActivityQueries({ turn: goalTurn, traces: [] });

    render(
      <SettingsActivityThreadDetail
        threadId="thread-1"
        breadcrumbParents={[{ label: "Activity", href: "/settings/activity" }]}
      />,
    );

    expect(screen.getByText("Goal runs")).toBeTruthy();
    expect(screen.getByText("Budget limited")).toBeTruthy();
    expect(screen.getByText("Prepare launch report")).toBeTruthy();
    expect(screen.getByText("Drafted two sections.")).toBeTruthy();
    expect(
      screen.getByText("Budget: Tenant goal budget reached."),
    ).toBeTruthy();
    expect(screen.getByText("Tokens: 125.0K / 125.0K")).toBeTruthy();
  });

  it("renders malformed goal-run evidence as bounded operator debug status", () => {
    const malformedTurn = {
      ...turn,
      resultJson: JSON.stringify({
        response: "Done",
        goal_run: "not-json",
      }),
    };
    vi.mocked(useQuery).mockReset();
    mockActivityQueries({ turn: malformedTurn, traces: [] });

    render(
      <SettingsActivityThreadDetail
        threadId="thread-1"
        breadcrumbParents={[{ label: "Activity", href: "/settings/activity" }]}
      />,
    );

    expect(screen.getByText("Status unavailable")).toBeTruthy();
    expect(screen.getByText("Malformed goal-run evidence")).toBeTruthy();
    expect(screen.getByText(/malformed_goal_run/)).toBeTruthy();
  });

  it("renders Agent Profile runs as nested steps with child tools and trace lane metadata", () => {
    const profileTurn = {
      ...turn,
      usageJson: JSON.stringify({
        model: "us.anthropic.claude-sonnet-4-6",
        input_tokens: 100,
        output_tokens: 207,
        cached_read_tokens: 15000,
        parent_usage: {
          input_tokens: 12,
          output_tokens: 183,
          cached_read_tokens: 10000,
        },
        duration_ms: 23200,
        tool_invocations: [
          {
            id: "delegate-profile-1",
            tool_name: "delegate_to_agent_profile",
            type: "tool",
            input_preview: '{"profile":"research"}',
            output_preview: "Delegated to Research",
            model_route: {
              model: "us.anthropic.claude-sonnet-4-6",
              input_tokens: 12,
              output_tokens: 0,
              cost_usd: 0.0014,
              status: "parent_model",
            },
          },
        ],
        agent_profile_runs: [
          {
            profileRunId: "profile-run-1",
            profileId: "profile-research",
            profileSlug: "research",
            profileName: "Research",
            model: "moonshotai.kimi-k2.5",
            status: "completed",
            inputTokens: 88,
            outputTokens: 24,
            cachedReadTokens: 5000,
            durationMs: 1600,
            costUsd: 0.0017,
            laneKey: "profile:research",
            handoffSummary: "Research handoff summary",
            loopEvidence: {
              loopId: "loop-research-1",
              ownerType: "profile",
              ownerSlug: "research",
              iterations: [
                {
                  index: 0,
                  phase: "self_review",
                  status: "completed",
                  verdict: "pass",
                },
              ],
            },
            toolInvocations: [
              {
                id: "child-web-search",
                tool_name: "web_search",
                type: "tool",
                input_preview: '{"query":"Stripe CEO"}',
                output_preview: "Search results",
              },
            ],
          },
        ],
      }),
      totalCost: 0.0048,
    };
    vi.mocked(useQuery).mockReset();
    mockActivityQueries({
      turn: profileTurn,
      traces: [
        {
          traceId: "trace-profile-1",
          parentRequestId: "turn-1",
          profileRunId: "profile-run-1",
          profileId: "profile-research",
          profileSlug: "research",
          profileName: "Research",
          laneKey: "profile:research",
          profileStatus: "completed",
          agentName: "Pi",
          runtimeType: "pi",
          model: "moonshotai.kimi-k2.5",
          inputTokens: 88,
          outputTokens: 24,
          durationMs: 1600,
          costUsd: 0.0017,
          createdAt: "2026-06-04T16:55:08.000Z",
        },
      ],
    });

    render(
      <SettingsActivityThreadDetail
        threadId="thread-1"
        breadcrumbParents={[{ label: "Activity", href: "/settings/activity" }]}
      />,
    );

    expect(screen.getByText("Research")).toBeTruthy();
    const delegateRow = screen.getByText(/Tool: delegate_to_agent_profile/);
    const researchRow = screen.getByText("Research");
    expect(
      delegateRow.compareDocumentPosition(researchRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByText("Kimi K2.5").length).toBeGreaterThan(0);
    expect(screen.getByTitle("Input / Output tokens").textContent).toContain(
      "100 → 207",
    );
    expect(screen.getByTitle("Input / Output tokens").textContent).toContain(
      "15.0K cached",
    );
    expect(screen.queryByText("Mixed")).toBeNull();
    expect(
      screen.getAllByText((_content, node) =>
        Boolean(node?.textContent?.replace(/\s+/g, "").includes("100→207")),
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/88.*24.*5\.0K cached/)).toBeTruthy();
    expect(screen.getByText("1.6s")).toBeTruthy();
    expect(screen.getByText("$0.0017")).toBeTruthy();
    expect(screen.queryByText("completed")).toBeNull();
    expect(screen.getByText("Tool: web_search")).toBeTruthy();
    expect(screen.queryByText(/not routed/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Research/ }));
    expect(screen.getByText(/Research handoff summary/)).toBeTruthy();
    expect(screen.getByText(/child-web-search/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Traces" }));
    expect(screen.getByText("profile:research")).toBeTruthy();
  });

  it("interleaves each delegate tool with the Agent Profile lane it starts", () => {
    const profileTurn = {
      ...turn,
      usageJson: JSON.stringify({
        model: "moonshotai.kimi-k2.5",
        input_tokens: 3500,
        output_tokens: 69,
        duration_ms: 16000,
        tool_invocations: [
          {
            id: "profile-run-research",
            tool_name: "delegate_to_agent_profile",
            type: "tool",
            args: { profileSlug: "research", task: "Find Stripe CEO" },
            input_preview: '{"profileSlug":"research"}',
            output_preview: "Delegated to Research",
            agent_profile_run: {
              profileRunId: "profile-run-research",
              profileSlug: "research",
            },
            model_route: {
              model: "moonshotai.kimi-k2.5",
              input_tokens: 3500,
              output_tokens: 35,
              cost_usd: 0.0032,
            },
          },
          {
            id: "profile-run-reviewer",
            tool_name: "delegate_to_agent_profile",
            type: "tool",
            args: { profileSlug: "reviewer", task: "Review research" },
            input_preview: '{"profileSlug":"reviewer"}',
            output_preview: "Delegated to Reviewer",
            agent_profile_run: {
              profileRunId: "profile-run-reviewer",
              profileSlug: "reviewer",
            },
            model_route: {
              model: "moonshotai.kimi-k2.5",
              input_tokens: 3500,
              output_tokens: 34,
              cost_usd: 0.0032,
            },
          },
        ],
        agent_profile_runs: [
          {
            profileRunId: "profile-run-research",
            profileSlug: "research",
            profileName: "Research",
            model: "moonshotai.kimi-k2.5",
            inputTokens: 25000,
            outputTokens: 133,
            durationMs: 10500,
            costUsd: 0.0154,
            loopEvidence: {
              loopId: "loop-research",
              ownerType: "profile",
              ownerSlug: "research",
              iterations: [
                {
                  index: 0,
                  phase: "handoff",
                  status: "completed",
                  verdict: "pass",
                },
              ],
            },
            toolInvocations: [
              {
                id: "research-web-search",
                tool_name: "web_search",
                type: "tool",
                input_preview: '{"query":"Stripe CEO"}',
                output_preview: "Search results",
              },
            ],
          },
          {
            profileRunId: "profile-run-reviewer",
            profileSlug: "reviewer",
            profileName: "Reviewer",
            model: "moonshotai.kimi-k2.5",
            inputTokens: 1100,
            outputTokens: 104,
            durationMs: 934,
            costUsd: 0.001,
            loopEvidence: {
              loopId: "loop-reviewer",
              ownerType: "profile",
              ownerSlug: "reviewer",
              iterations: [
                {
                  index: 0,
                  phase: "final_review",
                  status: "completed",
                  verdict: "pass",
                },
              ],
            },
            toolInvocations: [],
          },
        ],
      }),
      totalCost: 0.0227,
    };
    vi.mocked(useQuery).mockReset();
    mockActivityQueries({ turn: profileTurn, traces: [] });

    render(
      <SettingsActivityThreadDetail
        threadId="thread-1"
        breadcrumbParents={[{ label: "Activity", href: "/settings/activity" }]}
      />,
    );

    const delegateRows = screen.getAllByText(/Tool: delegate_to_agent_profile/);
    const researchRow = screen.getByText("Research");
    const researchToolRow = screen.getByText("Tool: web_search");
    const reviewerRow = screen.getByText("Reviewer");

    expect(delegateRows).toHaveLength(2);
    expect(
      delegateRows[0].compareDocumentPosition(researchRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      researchRow.compareDocumentPosition(researchToolRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      researchToolRow.compareDocumentPosition(delegateRows[1]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      delegateRows[1].compareDocumentPosition(reviewerRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(researchRow.closest("button")?.dataset.branchLane).toBe("0");
    expect(reviewerRow.closest("button")?.dataset.branchLane).toBe("0");
  });

  it("renders retry profile runs as separate sequential segments", () => {
    const profileTurn = {
      ...turn,
      usageJson: JSON.stringify({
        model: "moonshotai.kimi-k2.5",
        input_tokens: 4200,
        output_tokens: 120,
        parent_usage: {
          input_tokens: 4200,
          output_tokens: 120,
        },
        duration_ms: 18000,
        tool_invocations: [
          {
            id: "delegate-research-1",
            tool_name: "delegate_to_agent_profile",
            type: "tool",
            args: { profileSlug: "research" },
            agent_profile_run: {
              profileRunId: "profile-run-research-1",
              profileSlug: "research",
            },
          },
          {
            id: "delegate-reviewer",
            tool_name: "delegate_to_agent_profile",
            type: "tool",
            args: { profileSlug: "reviewer" },
            agent_profile_run: {
              profileRunId: "profile-run-reviewer",
              profileSlug: "reviewer",
            },
          },
          {
            id: "delegate-research-2",
            tool_name: "delegate_to_agent_profile",
            type: "tool",
            args: { profileSlug: "research" },
            agent_profile_run: {
              profileRunId: "profile-run-research-2",
              profileSlug: "research",
            },
          },
        ],
        agent_profile_runs: [
          {
            profileRunId: "profile-run-research-1",
            profileSlug: "research",
            profileName: "Research",
            model: "moonshotai.kimi-k2.5",
            inputTokens: 12000,
            outputTokens: 80,
            durationMs: 7000,
            costUsd: 0.008,
            loopEvidence: {
              iterations: [
                {
                  index: 0,
                  phase: "self_review",
                  status: "completed",
                  verdict: "pass",
                },
              ],
            },
          },
          {
            profileRunId: "profile-run-reviewer",
            profileSlug: "reviewer",
            profileName: "Reviewer",
            model: "moonshotai.kimi-k2.5",
            inputTokens: 1300,
            outputTokens: 90,
            durationMs: 900,
            costUsd: 0.001,
            loopEvidence: {
              iterations: [
                {
                  index: 0,
                  phase: "final_review",
                  status: "revision_requested",
                  verdict: "revise",
                  feedback: "Source must be current.",
                },
              ],
            },
          },
          {
            profileRunId: "profile-run-research-2",
            profileSlug: "research",
            profileName: "Research",
            model: "moonshotai.kimi-k2.5",
            inputTokens: 8000,
            outputTokens: 70,
            durationMs: 5000,
            costUsd: 0.006,
            loopEvidence: {
              iterations: [
                {
                  index: 1,
                  phase: "iteration",
                  status: "completed",
                  verdict: "pass",
                  feedback: "Updated the source.",
                },
              ],
            },
          },
        ],
      }),
      totalCost: 0.018,
    };
    vi.mocked(useQuery).mockReset();
    mockActivityQueries({ turn: profileTurn, traces: [] });

    render(
      <SettingsActivityThreadDetail
        threadId="thread-1"
        breadcrumbParents={[{ label: "Activity", href: "/settings/activity" }]}
      />,
    );

    const delegateRows = screen.getAllByText(/Tool: delegate_to_agent_profile/);
    const researchRows = screen.getAllByText("Research");
    const reviewerRow = screen.getByText("Reviewer");

    expect(delegateRows).toHaveLength(3);
    expect(researchRows).toHaveLength(2);
    expect(
      delegateRows[0].compareDocumentPosition(researchRows[0]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      reviewerRow.compareDocumentPosition(delegateRows[2]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      delegateRows[2].compareDocumentPosition(researchRows[1]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(researchRows[0].closest("button")?.dataset.branchLane).toBe("0");
    expect(reviewerRow.closest("button")?.dataset.branchLane).toBe("0");
    expect(researchRows[1].closest("button")?.dataset.branchLane).toBe("0");
  });
});
