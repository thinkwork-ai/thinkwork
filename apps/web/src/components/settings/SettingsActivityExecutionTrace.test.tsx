import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useQuery, useSubscription } from "urql";

// urql is fully mocked; each useQuery branches on its variables so the trace
// gets turns, empty invocation logs, and empty events.
vi.mock("urql", () => ({
  useQuery: vi.fn(),
  useSubscription: vi.fn(),
  gql: (s: TemplateStringsArray) => s.join(""),
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));

// Stub CodeMirror so the rendered system prompt is assertable in jsdom.
vi.mock("@uiw/react-codemirror", () => ({
  default: ({ value }: { value: string }) => (
    <div data-testid="codemirror" data-value={value} />
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Minimal @thinkwork/ui: Dialog respects `open` so we can assert the prompt
// dialog only appears after the Agent row is clicked. Collapsible content is
// always rendered so the timeline rows are visible without expanding.
vi.mock("@thinkwork/ui", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    cn: (...v: Array<string | false | null | undefined>) =>
      v.filter(Boolean).join(" "),
    Badge: Passthrough,
    Collapsible: Passthrough,
    CollapsibleContent: Passthrough,
    CollapsibleTrigger: Passthrough,
    Dialog: ({
      open,
      children,
    }: {
      open?: boolean;
      children?: React.ReactNode;
    }) => (open ? <div data-testid="dialog">{children}</div> : null),
    DialogContent: Passthrough,
    DialogDescription: Passthrough,
    DialogHeader: Passthrough,
    DialogTitle: Passthrough,
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
  };
});

import { ExecutionTrace } from "./SettingsActivityExecutionTrace";

type TurnSeed = {
  id: string;
  systemPrompt: string | null;
};

function makeTurn(seed: TurnSeed) {
  return {
    id: seed.id,
    status: "succeeded",
    startedAt: "2026-06-11T10:00:00Z",
    createdAt: "2026-06-11T10:00:00Z",
    finishedAt: "2026-06-11T10:00:30Z",
    totalCost: 0.01,
    runtimeType: "Pi",
    resultJson: null,
    usageJson: JSON.stringify({
      model: "kimi-k2.5",
      input_tokens: 100,
      output_tokens: 20,
      duration_ms: 1000,
    }),
    systemPrompt: seed.systemPrompt,
  };
}

function mockUrql(turns: ReturnType<typeof makeTurn>[]) {
  (useQuery as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (args: { variables?: Record<string, unknown> }) => {
      const vars = args?.variables ?? {};
      if ("turnId" in vars) {
        return [{ data: { turnInvocationLogs: [] }, fetching: false }, vi.fn()];
      }
      if ("runId" in vars) {
        return [{ data: { threadTurnEvents: [] }, fetching: false }, vi.fn()];
      }
      if ("threadId" in vars) {
        return [{ data: { threadTurns: turns }, fetching: false }, vi.fn()];
      }
      // model catalog or anything else
      return [{ data: undefined, fetching: false }, vi.fn()];
    },
  );
  (useSubscription as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
    { data: undefined },
  ]);
}

function agentRows(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll('[data-timeline-event-type="llm"]'),
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ExecutionTrace — Agent step system prompt", () => {
  it("shows the turn's captured system prompt when the Agent row is clicked", () => {
    mockUrql([makeTurn({ id: "turn-a", systemPrompt: "CAPTURED PROMPT A" })]);
    const { container } = render(
      <ExecutionTrace threadId="thread-1" tenantId="tenant-1" />,
    );

    expect(screen.queryByTestId("codemirror")).toBeNull();

    const rows = agentRows(container);
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.click(rows[0]);

    expect(screen.getByTestId("codemirror").getAttribute("data-value")).toBe(
      "CAPTURED PROMPT A",
    );
    // It opened the system-prompt dialog, not the generic Prettify-JSON detail.
    expect(screen.queryByText("Prettify JSON")).toBeNull();
  });

  it("shows each turn's own prompt (per-turn, not thread-latest)", () => {
    mockUrql([
      makeTurn({ id: "turn-old", systemPrompt: "OLD PROMPT" }),
      makeTurn({ id: "turn-new", systemPrompt: "NEW PROMPT" }),
    ]);
    const { container } = render(
      <ExecutionTrace threadId="thread-1" tenantId="tenant-1" />,
    );

    const rows = agentRows(container);
    expect(rows.length).toBe(2);

    fireEvent.click(rows[0]);
    expect(
      screen
        .getAllByTestId("codemirror")
        .map((n) => n.getAttribute("data-value")),
    ).toContain("OLD PROMPT");

    fireEvent.click(rows[1]);
    expect(
      screen
        .getAllByTestId("codemirror")
        .map((n) => n.getAttribute("data-value")),
    ).toContain("NEW PROMPT");
  });

  it("shows an empty state when the turn captured no prompt", () => {
    mockUrql([makeTurn({ id: "turn-empty", systemPrompt: null })]);
    const { container } = render(
      <ExecutionTrace threadId="thread-1" tenantId="tenant-1" />,
    );

    fireEvent.click(agentRows(container)[0]);

    expect(screen.getByTestId("trace-system-prompt-empty").textContent).toMatch(
      /No system prompt was captured for this turn/i,
    );
    expect(screen.queryByTestId("codemirror")).toBeNull();
  });
});
