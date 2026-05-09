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

    expect(screen.getByText("CRM pipeline risk")).toBeTruthy();
    expect(screen.getByText("Build a CRM pipeline dashboard")).toBeTruthy();
    expect(screen.getByText("I created a dashboard app.")).toBeTruthy();
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.getByText("Using data_visualization")).toBeTruthy();
    expect(screen.getByText("CRM pipeline risk app")).toBeTruthy();
    expect(screen.getByLabelText("Follow up")).toBeTruthy();
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

  it("derives the source count from message and turn evidence", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Sources thread",
          lifecycleStatus: "COMPLETED",
          messages: [
            {
              id: "message-1",
              role: "USER",
              content: "Find account risk",
            },
            {
              id: "message-2",
              role: "ASSISTANT",
              content: "Here is the risk.",
              metadata: {
                sources: [{ id: "crm-opportunities" }],
              },
              toolResults: [{ url: "https://example.test/account" }],
              durableArtifact: {
                id: "artifact_123",
                title: "CRM app",
                metadata: {
                  sourceStatuses: [{ provider: "lastmile-crm" }],
                },
              },
            },
          ],
          turns: [
            {
              id: "turn-1",
              status: "succeeded",
              usageJson: {
                tool_invocations: [
                  {
                    tool_name: "web_search",
                    input_preview: "account news",
                  },
                ],
              },
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("4 sources")).toBeTruthy();
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
