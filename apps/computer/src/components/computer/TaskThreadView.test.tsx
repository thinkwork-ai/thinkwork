import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskThreadView } from "./TaskThreadView";

afterEach(cleanup);

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
