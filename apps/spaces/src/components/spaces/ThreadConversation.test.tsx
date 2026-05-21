import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadConversation } from "./ThreadConversation";

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
});
