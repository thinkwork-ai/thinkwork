import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThreadWorkspaceView } from "./ThreadWorkspaceView";

vi.mock("@thinkwork/workspace-editor", () => ({
  WorkspaceFileEditor: ({ targetKey }: { targetKey: string }) => (
    <div data-testid="workspace-editor">{targetKey}</div>
  ),
}));

describe("ThreadWorkspaceView", () => {
  it("defaults to the thread Goal folder target", () => {
    render(
      <ThreadWorkspaceView
        threadId="thread-1"
        goalFiles={[{ file: "GOAL", content: "Outcome: done" }]}
      />,
    );

    expect(screen.getByTestId("workspace-editor").textContent).toBe(
      "thread:thread-1",
    );
  });
});
