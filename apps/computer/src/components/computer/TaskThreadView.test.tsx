import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskThreadView } from "./TaskThreadView";

afterEach(cleanup);

// Asserts the labelled element is actually a <details> before narrowing to
// HTMLDetailsElement. Without this guard, `as HTMLDetailsElement` would cast
// any HTMLElement and surface confusing "expected undefined" failures if the
// label ever migrates to a non-details element.
function getThinkingDetails(): HTMLDetailsElement {
  const el = screen.getByLabelText("Thinking and tool activity");
  expect(el.tagName.toLowerCase()).toBe("details");
  return el as HTMLDetailsElement;
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

  it("renders assistant Markdown wrapper with tightened prose density modifiers", () => {
    // U1 regression guard: dropping `prose-p:my-2 prose-li:my-0 …` reverts the
    // page to the loose default vertical rhythm that pre-merge content used.
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
      "prose-p:my-2",
      "prose-ul:my-2",
      "prose-ol:my-2",
      "prose-li:my-0",
      "prose-headings:mt-4",
      "prose-headings:mb-2",
    ]) {
      expect(cls).toContain(token);
    }
    // Pre-existing loose tokens must not survive the refactor.
    expect(cls).not.toContain("leading-8");
    expect(cls).not.toContain("prose-p:my-0");
  });

  it("renders the transcript segment grid with tightened gap-5 spacing", () => {
    // U1 regression guard: gap-8 wastes ~12px between every transcript segment.
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
    const grid = container.querySelector("div.gap-5");
    expect(grid).not.toBeNull();
    expect(container.querySelector("div.gap-8")).toBeNull();
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
    const details = getThinkingDetails();
    expect(details.open).toBe(false);
  });

  it("renders Thinking row expanded with the Run failed row visible when a turn errors", () => {
    // U2 / DL-002 regression guard: a failed turn must surface its error
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
    const details = getThinkingDetails();
    expect(details.open).toBe(true);
    expect(screen.getByText("Run failed")).toBeTruthy();
    expect(screen.getByText("Browser session timed out")).toBeTruthy();
  });

  it("renders Thinking row expanded with active spinner for queued and pending turns", () => {
    // U2 / DL-001 regression guard: pre-running statuses must communicate that
    // work is starting up rather than render an empty closed disclosure.
    for (const status of ["pending", "queued", "claimed"] as const) {
      const { container, unmount } = render(
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
      const details = getThinkingDetails();
      expect(details.open).toBe(true);
      // Active state pulses the brain icon (text-sky-400 + animate-pulse);
      // the static (terminal-clean) variant has the brain without the
      // animation class.
      expect(container.querySelector(".animate-pulse")).not.toBeNull();
      unmount();
    }
  });

  it("collapses the Thinking disclosure when a running turn transitions to a clean terminal status", () => {
    // U2: rerender with a status flip across the open-state boundary forces a
    // remount via the `key` strategy, applying defaultOpen=false.
    const baseThread = {
      id: "thread-1",
      title: "Collapse on finish",
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
    const runningDetails = getThinkingDetails();
    expect(runningDetails.open).toBe(true);

    rerender(
      <TaskThreadView
        thread={{
          ...baseThread,
          turns: [{ ...baseThread.turns[0], status: "completed" }],
        }}
      />,
    );
    const finishedDetails = getThinkingDetails();
    expect(finishedDetails.open).toBe(false);
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

  it("keeps the Thinking summary aria-label intact on the new <details> element", () => {
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
    expect(labelled.tagName.toLowerCase()).toBe("details");
  });

  it("sends follow-up messages from the composer", () => {
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

    expect(onSendFollowUp).toHaveBeenCalledWith("Add detail");
  });
});
