import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/apps/InlineAppletEmbed", () => ({
  InlineAppletEmbed: ({ appId }: { appId: string }) => (
    <div data-testid="inline-applet-embed-stub" data-app-id={appId} />
  ),
}));

import { TaskThreadView } from "./TaskThreadView";

afterEach(cleanup);

function getThinkingDisclosure(): HTMLElement {
  const el = screen.getByLabelText("Thinking and tool activity");
  expect(el.getAttribute("data-state")).not.toBeNull();
  return el;
}

function openThinkingDisclosure(index = 0): HTMLElement {
  const buttons = screen.getAllByRole("button", { name: /thinking/i });
  fireEvent.click(buttons[index]);
  const disclosures = screen.getAllByLabelText("Thinking and tool activity");
  expect(disclosures[index].getAttribute("data-state")).toBe("open");
  return disclosures[index];
}

describe("TaskThreadView", () => {
  it("renders transcript messages, generated artifact cards, and command composer", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "CRM pipeline risk",
          lifecycleStatus: "COMPLETED",
          costSummary: 0.42,
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Build a CRM pipeline dashboard",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content: "I created a dashboard app.",
              metadata: {
                summary: "Built a dashboard from CRM opportunity data.",
              },
              toolCalls: [{ name: "data_visualization" }],
              durableArtifact: {
                id: "artifact_123",
                title: "CRM pipeline risk app",
                type: "DATA_VIEW",
                summary: "Stale opportunity analysis",
                metadata: { kind: "research_dashboard" },
              },
            },
          ],
        }}
      />,
    );

    // Thread title now lives in AppTopBar via PageHeaderContext, not inside TaskThreadView.
    expect(screen.getByText("Build a CRM pipeline dashboard")).toBeTruthy();
    expect(screen.getByText("I created a dashboard app.")).toBeTruthy();
    expect(screen.getByRole("log", { name: "Thread transcript" })).toBeTruthy();
    expect(document.querySelector('[data-message-role="user"]')).toBeTruthy();
    expect(
      document.querySelector('[data-message-role="assistant"]'),
    ).toBeTruthy();
    expect(screen.getByText("Using data_visualization")).toBeTruthy();
    expect(screen.getByText("CRM pipeline risk app")).toBeTruthy();
    expect(screen.getByLabelText("Follow up")).toBeTruthy();
    // No turn → no turn-level Thinking; tool calls present → no fallback Thinking;
    // per-message Thinking row was removed because it was a duplicate of the
    // authoritative turn-level row.
    expect(screen.queryByText("Thinking")).toBeNull();
    expect(screen.queryByText("Computer planned the response.")).toBeNull();
  });

  it("renders exactly one Thinking row when an assistant message has no tool calls and a turn is running", () => {
    // Regression: before C-01 the per-message fallback ThinkingRow ('Reasoning
    // complete.') fired here on top of the turn-level ThinkingRow, producing
    // two 'Thinking' rows in the case the user originally reported in
    // screenshots #28 / #29 (assistant message used no tools).
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "No-tool assistant",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Read example.com",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content: "The page title is **Example Domain**.",
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "running",
              invocationSource: "chat_message",
            },
          ],
        }}
      />,
    );

    expect(screen.getAllByText("Thinking")).toHaveLength(1);
    expect(screen.queryByText("Reasoning complete.")).toBeNull();
  });

  it("renders exactly one Thinking row when both an assistant message and a running turn exist", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "One thinking only",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Investigate",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content: "On it.",
              toolCalls: [{ name: "crm_search" }],
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "running",
              invocationSource: "chat_message",
            },
          ],
        }}
      />,
    );

    expect(screen.getAllByText("Thinking")).toHaveLength(1);
    // Anchor the surviving row to the authoritative turn-level container so a
    // future regression that moves the row back into per-message rendering
    // would fail this test rather than silently keep the count at 1.
    expect(screen.getByLabelText("Thinking and tool activity")).toBeTruthy();
    expect(screen.queryByText("Computer planned the response.")).toBeNull();
  });

  it("renders a thinking row when the thread has no messages", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Blank thread",
          lifecycleStatus: "IDLE",
          messages: [],
        }}
      />,
    );

    expect(screen.getByText("Thinking")).toBeTruthy();
  });

  it("renders streaming assistant chunks below persisted messages", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Streaming thread",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Think out loud",
            },
          ],
        }}
        streamingChunks={[
          { seq: 1, text: "Working" },
          { seq: 2, text: " on it" },
        ]}
      />,
    );

    expect(screen.getByText("Working on it")).toBeTruthy();
    expect(screen.getByLabelText("Computer is typing")).toBeTruthy();
  });

  it("renders persisted runbook queue parts after reload", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Runbook thread",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Run the research dashboard",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content: "Starting Research Dashboard.",
              parts: [
                {
                  type: "data-runbook-queue",
                  id: "runbook-queue:run-1",
                  data: {
                    runbookRunId: "run-1",
                    displayName: "Research Dashboard",
                    status: "QUEUED",
                    phases: [
                      {
                        id: "discover",
                        title: "Discover",
                        tasks: [
                          {
                            id: "task-1",
                            title: "Gather source material",
                            status: "PENDING",
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Research Dashboard")).toBeTruthy();
    expect(screen.getByText("Discover")).toBeTruthy();
    expect(screen.getByText("Gather source material")).toBeTruthy();
    expect(screen.queryByText("Starting Research Dashboard.")).toBeNull();
  });

  it("renders a completed turn response when the assistant message has not refetched yet", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Completed turn",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "What is my name?",
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "succeeded",
              invocationSource: "chat_message",
              finishedAt: "2026-05-08T20:00:00Z",
              resultJson: {
                response: "Your name is Eric.",
              },
            },
          ],
        }}
        streamingChunks={[
          { seq: 1, text: "Your" },
          { seq: 2, text: " name" },
        ]}
      />,
    );

    expect(screen.getByText("Your name is Eric.")).toBeTruthy();
    expect(screen.queryByLabelText("Computer is typing")).toBeNull();
  });

  it("renders a completed Computer task response when the assistant message has not refetched yet", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Completed task",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "What is my name?",
            },
          ],
          turns: [
            {
              id: "task-1",
              status: "COMPLETED",
              invocationSource: "chat_message",
              finishedAt: "2026-05-08T20:00:00Z",
              resultJson: {
                response: "Your name is Eric.",
                responseMessageId: "message-2",
              },
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Your name is Eric.")).toBeTruthy();
  });

  it("renders thread turn thinking and tool details", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Tool trace thread",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Find account risk",
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "running",
              invocationSource: "chat_message",
              usageJson: {
                tools_called: ["crm_search"],
                input_tokens: 1200,
                output_tokens: 300,
              },
            },
          ],
        }}
      />,
    );

    expect(screen.getByLabelText("Thinking and tool activity")).toBeTruthy();
    openThinkingDisclosure();
    expect(screen.getByText("Finding sources")).toBeTruthy();
    expect(screen.getByText(/Manual chat/)).toBeTruthy();
    expect(screen.getByText(/1.2K in \/ 300 out/)).toBeTruthy();
  });

  it("renders durable Computer event detail rows for a thread turn", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Browser trace thread",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Use the browser",
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "running",
              invocationSource: "chat_message",
              events: [
                {
                  id: "event-1",
                  eventType: "browser_automation_started",
                  level: "INFO",
                  payload: {
                    url: "https://example.com",
                    task: "Read the page title",
                    taskId: "task-1",
                  },
                  createdAt: "2026-05-09T08:01:00Z",
                },
                {
                  id: "event-2",
                  eventType: "browser_automation_completed",
                  level: "INFO",
                  payload: { responseLen: 12 },
                  createdAt: "2026-05-09T08:01:05Z",
                },
              ],
            },
          ],
        }}
      />,
    );

    openThinkingDisclosure();
    expect(screen.getByText("Opening browser")).toBeTruthy();
    expect(screen.getByText("Browser completed")).toBeTruthy();
    expect(screen.getByText(/https:\/\/example.com/)).toBeTruthy();
    expect(
      screen.getByText(/"instruction": "Read the page title"/),
    ).toBeTruthy();
    expect(screen.getByText(/"runId": "task-1"/)).toBeTruthy();
    expect(screen.queryByText(/"task":/)).toBeNull();
    expect(screen.queryByText(/"taskId":/)).toBeNull();
  });

  it("renders turn events in chronological order regardless of input order", () => {
    // The computerEvents resolver returns events DESC; this fixture mirrors
    // that wire shape. Rendering must invert it so the user sees the timeline
    // oldest-at-top → newest-at-bottom.
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Order check",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Run it",
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "running",
              invocationSource: "chat_message",
              events: [
                {
                  id: "event-late",
                  eventType: "browser_automation_completed",
                  payload: {},
                  createdAt: "2026-05-09T11:58:07Z",
                },
                {
                  id: "event-mid",
                  eventType: "browser_automation_started",
                  payload: { url: "https://example.com" },
                  createdAt: "2026-05-09T11:58:00.530Z",
                },
                {
                  id: "event-early",
                  eventType: "thread_turn_enqueued",
                  payload: {},
                  createdAt: "2026-05-09T11:58:00.500Z",
                },
              ],
            },
          ],
        }}
      />,
    );

    openThinkingDisclosure();
    const rendered = [
      screen.getByText("thread turn enqueued"),
      screen.getByText("Opening browser"),
      screen.getByText("Browser completed"),
    ];
    // Each row's title is unique; compare DOM order via compareDocumentPosition
    expect(
      rendered[0].compareDocumentPosition(rendered[1]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      rendered[1].compareDocumentPosition(rendered[2]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("stably orders events with identical createdAt by event id", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Tiebreak check",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Tiebreak",
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "running",
              invocationSource: "chat_message",
              events: [
                // Resolver-DESC order with identical timestamps; expected
                // render order is by id ascending: event-a, event-b.
                {
                  id: "event-b",
                  eventType: "browser_automation_completed",
                  payload: {},
                  createdAt: "2026-05-09T11:58:00.530Z",
                },
                {
                  id: "event-a",
                  eventType: "browser_automation_started",
                  payload: { url: "https://example.com" },
                  createdAt: "2026-05-09T11:58:00.530Z",
                },
              ],
            },
          ],
        }}
      />,
    );

    openThinkingDisclosure();
    const opening = screen.getByText("Opening browser");
    const completed = screen.getByText("Browser completed");
    expect(
      opening.compareDocumentPosition(completed) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the mobile-style processing shimmer while waiting for the first chunk", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Waiting thread",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Answer me",
            },
          ],
          turns: [
            {
              id: "task-1",
              status: "RUNNING",
              invocationSource: "chat_message",
            },
          ],
        }}
      />,
    );

    expect(screen.getByLabelText("Processing request")).toBeTruthy();
    expect(screen.queryByLabelText("Computer is typing")).toBeNull();
  });

  it("prefers streaming chunks over the processing shimmer", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Streaming thread",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Answer me",
            },
          ],
          turns: [
            {
              id: "task-1",
              status: "RUNNING",
              invocationSource: "chat_message",
            },
          ],
        }}
        streamingChunks={[{ seq: 1, text: "Streaming now" }]}
      />,
    );

    expect(screen.getByText("Streaming now")).toBeTruthy();
    expect(screen.queryByLabelText("Processing request")).toBeNull();
  });

  it("renders Markdown bold and pipe tables in assistant content", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Markdown render",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "List leads",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content:
                "Here are your **leads**:\n\n| # | Title | Stage |\n|---|---|---|\n| 1 | Royal Concrete | Working |\n| 2 | Diesel Fleet Care | Working |",
            },
          ],
        }}
      />,
    );

    // Bold text is rendered (Streamdown wraps it; the visible text is what matters).
    expect(screen.getByText("leads")).toBeTruthy();
    // Table rendered as a real <table>
    expect(document.querySelector("table")).not.toBeNull();
    // Cells render the row content
    expect(screen.getByText("Royal Concrete")).toBeTruthy();
    expect(screen.getByText("Diesel Fleet Care")).toBeTruthy();
  });

  it("renders Markdown links as anchor elements with safe URLs", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Link render",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Visit",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content: "Visit [example](https://example.com).",
            },
          ],
        }}
      />,
    );

    // The link text renders. Streamdown renders links through a link-safety
    // component (button-shaped at v2) rather than a bare <a>, so we assert
    // visible text rather than the element type — the latter is a private
    // implementation detail of Streamdown.
    expect(screen.getByText("example")).toBeTruthy();
  });

  it("renders streaming chunks through the Markdown parser", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Streaming markdown",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Stream me",
            },
          ],
        }}
        streamingChunks={[
          { seq: 1, text: "**Working**" },
          { seq: 2, text: " on it" },
        ]}
      />,
    );

    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByLabelText("Computer is typing")).toBeTruthy();
  });

  it("renders streaming partial Markdown without crashing", () => {
    // Mid-table token sequence — the row terminator hasn't arrived yet.
    expect(() =>
      render(
        <TaskThreadView
          thread={{
            id: "thread-1",
            title: "Partial markdown",
            lifecycleStatus: "RUNNING",
            messages: [
              {
                id: "message-1",
                role: "USER",
                content: "Stream a partial table",
              },
            ],
          }}
          streamingChunks={[
            { seq: 1, text: "| col1 | col2 |\n|---|---|\n| a | " },
          ]}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByLabelText("Computer is typing")).toBeTruthy();
  });

  it("renders empty content placeholder when assistant message body is blank", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Blank assistant",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Hello",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content: "   ",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("(No message content)")).toBeTruthy();
  });

  it("renders assistant Markdown wrapper with Codex-transcript prose density", () => {
    // Regression guard: matches the tightened token set targeted by the
    // "make Computer match the Codex CLI transcript density" iteration —
    // text-sm + leading-5 + my-1.5 paragraph/list margins, prose-sm modifier
    // shrinks the inline element rhythm. Reverting any one token sends the
    // page back toward the looser pre-merge rhythm.
    const { container } = render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Density check",
          lifecycleStatus: "COMPLETED",
          messages: [
            { id: "m1", role: "USER", content: "List options" },
            {
              id: "m2",
              role: "ASSISTANT",
              content: "## Options\n\n- Alpha\n- Beta\n- Gamma",
            },
          ],
        }}
      />,
    );
    const proseWrapper = container.querySelector("div.prose");
    expect(proseWrapper).not.toBeNull();
    const cls = proseWrapper!.className;
    for (const token of [
      "prose-sm",
      "text-sm",
      "leading-5",
      "prose-p:leading-5",
      "prose-li:leading-5",
      "prose-p:my-1.5",
      "prose-ul:my-1.5",
      "prose-ol:my-1.5",
      "prose-li:my-0",
      "prose-headings:mt-3",
      "prose-headings:mb-1.5",
    ]) {
      expect(cls).toContain(token);
    }
    // Loose tokens from earlier iterations must not survive.
    expect(cls).not.toContain("leading-8");
    expect(cls).not.toContain("text-[1.05rem]");
    expect(cls).not.toContain("prose-p:my-0");
    expect(cls).not.toContain("prose-p:my-2");
  });

  it("renders the transcript segment grid with tightened gap-3 spacing", () => {
    // U1 regression guard: gap-8 (and the interim gap-5) waste vertical
    // space between transcript segments — Thinking should sit close to the
    // assistant answer it precedes, like one continuous thought.
    const { container } = render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Gap check",
          lifecycleStatus: "RUNNING",
          messages: [
            { id: "m1", role: "USER", content: "Hi" },
            { id: "m2", role: "ASSISTANT", content: "Hello." },
          ],
        }}
      />,
    );
    const grid = container.querySelector("div.gap-3");
    expect(grid).not.toBeNull();
    expect(container.querySelector("div.gap-8")).toBeNull();
    expect(container.querySelector("div.gap-5")).toBeNull();
  });

  it("renders Thinking row collapsed when a turn completes cleanly", () => {
    // U2 collapse-on-finish: defaultOpen is false for terminal-clean states so
    // child action rows nest inside the closed disclosure by default.
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Completed quietly",
          lifecycleStatus: "COMPLETED",
          messages: [{ id: "m1", role: "USER", content: "Pull leads" }],
          turns: [
            {
              id: "turn-1",
              status: "succeeded",
              invocationSource: "chat_message",
              finishedAt: "2026-05-09T08:01:05Z",
              events: [
                {
                  id: "e1",
                  eventType: "browser_automation_started",
                  payload: { url: "https://example.com" },
                  createdAt: "2026-05-09T08:01:00Z",
                },
              ],
            },
          ],
        }}
      />,
    );
    const disclosure = getThinkingDisclosure();
    expect(disclosure.getAttribute("data-state")).toBe("closed");
  });

  it("nests the Run failed row inside the Thinking disclosure when a turn errors", () => {
    // The Run failed row lives inside Thinking now. Thinking is collapsed
    // by default to avoid content shift, so the error is one click away.
    // without forcing the user to expand a closed disclosure.
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Failed turn",
          lifecycleStatus: "COMPLETED",
          messages: [{ id: "m1", role: "USER", content: "Reach the page" }],
          turns: [
            {
              id: "turn-1",
              status: "failed",
              invocationSource: "chat_message",
              finishedAt: "2026-05-09T08:01:05Z",
              error: "Browser session timed out",
            },
          ],
        }}
      />,
    );
    const disclosure = getThinkingDisclosure();
    expect(disclosure.getAttribute("data-state")).toBe("closed");
    expect(screen.queryByText("Run failed")).toBeNull();
    expect(screen.queryByText("Browser session timed out")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /thinking/i }));
    expect(getThinkingDisclosure().getAttribute("data-state")).toBe("open");
    expect(screen.queryByText("Run failed")).toBeTruthy();
    expect(screen.queryByText("Browser session timed out")).toBeTruthy();
  });

  it("defaults Thinking closed for every turn status to prevent content shift", () => {
    // The user explicitly does not want streaming action rows pushing the
    // page taller as a turn runs. Closing Thinking by default keeps the
    // viewport stable; ProcessingShimmer is the only in-flight signal that
    // grows the height (and only by one line). User can click to expand.
    for (const status of [
      "running",
      "pending",
      "queued",
      "claimed",
      "completed",
      "succeeded",
      "failed",
    ] as const) {
      const { unmount } = render(
        <TaskThreadView
          thread={{
            id: `thread-${status}`,
            title: `${status} turn`,
            lifecycleStatus: "RUNNING",
            messages: [{ id: "m1", role: "USER", content: "Start" }],
            turns: [
              {
                id: "turn-1",
                status,
                invocationSource: "chat_message",
              },
            ],
          }}
        />,
      );
      const disclosure = getThinkingDisclosure();
      expect(disclosure.getAttribute("data-state")).toBe("closed");
      unmount();
    }
  });

  it("preserves user-toggled Thinking state across passive re-renders within the same status", () => {
    // No more key-based remount on status flip — the user's manual expand
    // sticks even when the parent re-renders for unrelated reasons (chunk
    // arrival, polling, etc).
    const baseThread = {
      id: "thread-1",
      title: "Toggle persistence",
      lifecycleStatus: "RUNNING",
      messages: [{ id: "m1", role: "USER", content: "Run" }],
      turns: [
        {
          id: "turn-1",
          status: "running",
          invocationSource: "chat_message",
        },
      ],
    };

    const { rerender } = render(<TaskThreadView thread={baseThread} />);
    const disclosure = getThinkingDisclosure();
    expect(disclosure.getAttribute("data-state")).toBe("closed");

    fireEvent.click(screen.getByRole("button", { name: /thinking/i }));

    rerender(<TaskThreadView thread={{ ...baseThread }} />);
    const reRendered = getThinkingDisclosure();
    expect(reRendered.getAttribute("data-state")).toBe("open");
  });

  it("does not synthesize a fallback response when a new turn is in flight after a previous completed turn", () => {
    // Regression: withTurnResponseFallback used to append the latest *completed*
    // turn's response after the latest user message, even when the latest user
    // message was a brand-new question whose own turn was still running. The
    // result was the previous answer rendered as a phantom duplicate below the
    // new question's running Thinking row.
    const previousResponse =
      "Two great options at the same location — Springdale General.";
    render(
      <TaskThreadView
        thread={{
          id: "thread-flight",
          title: "Mid-flight follow-up",
          lifecycleStatus: "RUNNING",
          messages: [
            {
              id: "u1",
              role: "USER",
              content: "Find the farmer's market",
              createdAt: "2026-05-09T10:00:00Z",
            },
            {
              id: "a1",
              role: "ASSISTANT",
              content: previousResponse,
              createdAt: "2026-05-09T10:00:30Z",
            },
            {
              id: "u2",
              role: "USER",
              content: "What is its address?",
              createdAt: "2026-05-09T10:01:00Z",
            },
          ],
          turns: [
            // Newest first (resolver emits DESC). The new turn for u2 is still
            // running; the previous turn for u1 is completed but its response
            // is already represented by message a1.
            {
              id: "turn-2",
              status: "running",
              invocationSource: "chat_message",
              startedAt: "2026-05-09T10:01:01Z",
            },
            {
              id: "turn-1",
              status: "succeeded",
              invocationSource: "chat_message",
              startedAt: "2026-05-09T10:00:00Z",
              finishedAt: "2026-05-09T10:00:30Z",
              resultJson: { response: previousResponse },
            },
          ],
        }}
      />,
    );

    // The previous response should appear exactly once (as the persisted
    // assistant message a1), not twice (no synthesized duplicate below u2).
    expect(
      screen.getAllByText(previousResponse, { exact: false }),
    ).toHaveLength(1);
  });

  it("renders live tool_invocation_started events with toolActionTitle formatting", () => {
    // U4 regression guard: the Strands runtime emits tool_invocation_started
    // events as tools begin (instead of waiting for end-of-turn). The UI
    // must format them with the same toolActionTitle helper used for
    // post-turn usage.tool_invocations so the live row's title matches what
    // the row will look like once the turn finishes.
    render(
      <TaskThreadView
        thread={{
          id: "thread-live",
          title: "Live tools",
          lifecycleStatus: "RUNNING",
          messages: [{ id: "u1", role: "USER", content: "Find sources" }],
          turns: [
            {
              id: "turn-1",
              status: "running",
              invocationSource: "chat_message",
              events: [
                {
                  id: "e1",
                  eventType: "tool_invocation_started",
                  payload: {
                    tool_name: "web_search",
                    tool_use_id: "tool-1",
                    input_preview: "best brunch east austin",
                  },
                  createdAt: "2026-05-09T11:30:00Z",
                },
                {
                  id: "e2",
                  eventType: "tool_invocation_started",
                  payload: { tool_name: "recall", tool_use_id: "tool-2" },
                  createdAt: "2026-05-09T11:30:01Z",
                },
              ],
            },
          ],
        }}
      />,
    );
    // toolActionTitle maps "web_search" → "Finding sources" and "recall" →
    // "Checking memory" — verifying the live event uses that formatter.
    openThinkingDisclosure();
    expect(screen.getByText("Finding sources")).toBeTruthy();
    expect(screen.getByText("Checking memory")).toBeTruthy();
  });

  it("dedupes live tool_invocation_started events against post-turn usage.tool_invocations", () => {
    // U4 regression guard: when a turn finishes, the same tool appears in
    // both `usage.tool_invocations` (post-turn reconstruction) and the
    // streaming events list. Without dedup, the row renders twice.
    render(
      <TaskThreadView
        thread={{
          id: "thread-dedup",
          title: "Dedup",
          lifecycleStatus: "COMPLETED",
          messages: [{ id: "u1", role: "USER", content: "Find sources" }],
          turns: [
            {
              id: "turn-1",
              status: "succeeded",
              invocationSource: "chat_message",
              usageJson: {
                tool_invocations: [
                  {
                    tool_name: "web_search",
                    input_preview: "best brunch east austin",
                    output_preview: "...",
                    status: "success",
                  },
                ],
              },
              events: [
                {
                  id: "e1",
                  eventType: "tool_invocation_started",
                  payload: {
                    tool_name: "web_search",
                    tool_use_id: "tool-1",
                  },
                  createdAt: "2026-05-09T11:30:00Z",
                },
              ],
            },
          ],
        }}
      />,
    );
    // Exactly one "Finding sources" row, not two.
    openThinkingDisclosure();
    expect(screen.getAllByText("Finding sources")).toHaveLength(1);
  });

  it("renders one Thinking disclosure per turn, anchored to its user message in chronological order", () => {
    // U3 regression guard: prior behavior attached only the latest turn's
    // activity to the latest user message, leaving earlier turns invisible.
    // Admin shows a Thinking row per user/computer pair; Computer must match.
    render(
      <TaskThreadView
        thread={{
          id: "thread-multi",
          title: "Multi-turn",
          lifecycleStatus: "COMPLETED",
          messages: [
            { id: "u1", role: "USER", content: "First question" },
            {
              id: "a1",
              role: "ASSISTANT",
              content: "First answer",
            },
            { id: "u2", role: "USER", content: "Second question" },
            {
              id: "a2",
              role: "ASSISTANT",
              content: "Second answer",
            },
          ],
          // Resolver emits turns DESC; the component must sort ASC before
          // pairing with user messages.
          turns: [
            {
              id: "turn-2",
              status: "succeeded",
              invocationSource: "chat_message",
              startedAt: "2026-05-09T10:05:00Z",
              finishedAt: "2026-05-09T10:05:30Z",
            },
            {
              id: "turn-1",
              status: "succeeded",
              invocationSource: "chat_message",
              startedAt: "2026-05-09T10:00:00Z",
              finishedAt: "2026-05-09T10:00:30Z",
            },
          ],
        }}
      />,
    );

    // Exactly one Thinking summary per turn, both with the labelled-region affordance.
    const thinkingDetailsList = screen.getAllByLabelText(
      "Thinking and tool activity",
    );
    expect(thinkingDetailsList).toHaveLength(2);

    // Chronological order: the first user's Thinking row must appear before
    // the second user's Thinking row in the DOM.
    const [first, second] = thinkingDetailsList;
    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the Thinking summary aria-label intact on the Reasoning disclosure", () => {
    // U2 / DL-003: dropping the <article> wrapper must not lose the labelled
    // region affordance. Screen readers continue to find the same name.
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Aria check",
          lifecycleStatus: "RUNNING",
          messages: [{ id: "m1", role: "USER", content: "Run" }],
          turns: [
            {
              id: "turn-1",
              status: "running",
              invocationSource: "chat_message",
            },
          ],
        }}
      />,
    );
    const labelled = screen.getByLabelText("Thinking and tool activity");
    expect(labelled.getAttribute("data-state")).toBe("closed");
  });

  it("sends follow-up messages from the composer", async () => {
    // Plan-012 U13: PromptInput form submit is async (Promise.all
    // chain through file conversion before dispatch). useComposerState
    // tracks the text so we type via the textarea and click submit;
    // waitFor handles the microtask boundary.
    const onSendFollowUp = vi.fn();
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Follow-up thread",
          lifecycleStatus: "IDLE",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Start",
            },
          ],
        }}
        onSendFollowUp={onSendFollowUp}
      />,
    );

    fireEvent.change(screen.getByLabelText("Follow up"), {
      target: { value: "Add detail" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(onSendFollowUp).toHaveBeenCalledWith("Add detail");
    });
  });
});
