import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuery, useSubscription } from "urql";

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

function mockActivityQueries() {
  vi.mocked(useQuery)
    .mockReturnValue([
      {
        data: {},
        fetching: false,
        error: undefined,
        stale: false,
        hasNext: false,
      },
      vi.fn(),
    ])
    .mockReturnValueOnce([
      {
        data: { thread },
        fetching: false,
        error: undefined,
        stale: false,
        hasNext: false,
      },
      vi.fn(),
    ])
    .mockReturnValueOnce([
      {
        data: { threadTurns: [turn] },
        fetching: false,
        error: undefined,
        stale: false,
        hasNext: false,
      },
      vi.fn(),
    ])
    .mockReturnValueOnce([
      {
        data: {
          threadTraces: [
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
          ],
        },
        fetching: false,
        error: undefined,
        stale: false,
        hasNext: false,
      },
      vi.fn(),
    ])
    .mockReturnValueOnce([
      {
        data: { threadTurns: [turn] },
        fetching: false,
        error: undefined,
        stale: false,
        hasNext: false,
      },
      vi.fn(),
    ]);
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
    expect(screen.getByRole("heading", { name: "Activity" })).toBeTruthy();
    expect(screen.queryByText("Properties")).toBeNull();
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.getByText("Tool: web_search")).toBeTruthy();
    expect(screen.getByText("claude-haiku-4-5-20251001")).toBeTruthy();
    expect(screen.getByText(/1\.2K->34/)).toBeTruthy();
    expect(screen.getByText("$0.0012")).toBeTruthy();
    expect(screen.getByText("succeeded")).toBeTruthy();
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
    expect(headerArgs.actionKey).toBe("thread-properties-closed");

    render(headerArgs.action);
    mockActivityQueries();
    fireEvent.click(
      screen.getByRole("button", { name: "Open thread properties" }),
    );
    expect(screen.getByText("Properties")).toBeTruthy();
  });
});
