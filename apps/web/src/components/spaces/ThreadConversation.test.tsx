import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAnalyticsJsonRenderFixture,
  createTaskReviewJsonRenderFixture,
} from "@/components/workbench/json-render/fixtures";
import { ThreadConversation } from "./ThreadConversation";

vi.mock("urql", async () => {
  const actual = await vi.importActual<typeof import("urql")>("urql");
  return {
    ...actual,
    useMutation: () => [{ fetching: false }, vi.fn()],
  };
});

afterEach(cleanup);

describe("ThreadConversation", () => {
  it("renders grouped participant messages with mention highlighting", () => {
    render(
      <ThreadConversation
        messages={[
          {
            id: "m1",
            role: "USER",
            content: "Can @Coordinator review this?",
            createdAt: "2026-05-19T12:00:00Z",
            sender: { type: "user", id: "u1", displayName: "Sales Rep" },
            mentions: [
              {
                id: "mention-1",
                targetType: "AGENT",
                targetId: "a1",
                displayName: "Coordinator",
              },
            ],
          },
          {
            id: "m2",
            role: "USER",
            content: "The sales tax form is attached.",
            createdAt: "2026-05-19T12:01:00Z",
            sender: { type: "user", id: "u1", displayName: "Sales Rep" },
          },
          {
            id: "m3",
            role: "ASSISTANT",
            content: "I will check blockers.",
            createdAt: "2026-05-19T12:02:00Z",
            sender: { type: "agent", id: "a1", displayName: "Coordinator" },
          },
        ]}
      />,
    );

    expect(screen.getByText("Sales Rep")).toBeTruthy();
    expect(screen.getByText("@Coordinator")).toBeTruthy();
    expect(screen.getByText("The sales tax form is attached.")).toBeTruthy();
    expect(screen.getByText("Coordinator")).toBeTruthy();
  });

  it("renders system messages as compact milestones", () => {
    render(
      <ThreadConversation
        messages={[
          {
            id: "m1",
            role: "SYSTEM",
            content: "Credit report completed",
          },
        ]}
      />,
    );

    expect(screen.getByText("Credit report completed")).toBeTruthy();
  });

  it("renders downloadable attachment chips from persisted message metadata", () => {
    const onDownloadAttachment = vi.fn();
    render(
      <ThreadConversation
        attachments={[
          {
            id: "attachment-1",
            name: "Financial Sample.xlsx",
            sizeBytes: 2048,
          },
        ]}
        onDownloadAttachment={onDownloadAttachment}
        messages={[
          {
            id: "m1",
            role: "USER",
            content: "Here's the financials",
            metadata: {
              attachments: [{ attachmentId: "attachment-1" }],
            },
          },
        ]}
      />,
    );

    const chip = screen.getByRole("button", {
      name: "Download Financial Sample.xlsx",
    });
    expect(chip).toBeTruthy();
    fireEvent.click(chip);
    expect(onDownloadAttachment).toHaveBeenCalledWith("attachment-1");
  });

  it("renders persisted data-json-render parts through the shared Thread renderer", () => {
    const part = createTaskReviewJsonRenderFixture();

    render(
      <ThreadConversation
        messages={[
          {
            id: "m1",
            role: "ASSISTANT",
            content: "",
            parts: [part],
            sender: { type: "agent", id: "a1", displayName: "Coordinator" },
          },
        ]}
      />,
    );

    expect(screen.getByTestId("genui-task-review")).toBeTruthy();
    expect(screen.getByText("Review onboarding task")).toBeTruthy();
  });

  it("renders a persisted analytics json-render domain part inside a Thread message", () => {
    const part = createAnalyticsJsonRenderFixture();

    render(
      <ThreadConversation
        messages={[
          {
            id: "m1",
            role: "ASSISTANT",
            content: "",
            parts: [part],
            sender: { type: "agent", id: "a1", displayName: "Coordinator" },
          },
        ]}
      />,
    );

    expect(screen.getByTestId("json-render-analytics-display")).toBeTruthy();
    expect(screen.getByText("Support volume")).toBeTruthy();
    expect(screen.getByText(/ThinkWork analytics adapter/)).toBeTruthy();
  });
});
