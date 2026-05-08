import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
    expect(screen.getByText("CRM pipeline risk app")).toBeTruthy();
    expect(screen.getByLabelText("Follow up")).toBeTruthy();
  });

  it("renders a task-created event when the thread has no messages", () => {
    render(
      <TaskThreadView
        thread={{
          id: "thread-1",
          title: "Blank task",
          lifecycleStatus: "IDLE",
          messages: [],
        }}
      />,
    );

    expect(screen.getByText("Task created")).toBeTruthy();
  });
});
