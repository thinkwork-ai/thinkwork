import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stub the CodeMirror editor to a plain element so we can assert the bound
// value without driving the real editor in jsdom.
vi.mock("@uiw/react-codemirror", () => ({
  default: ({ value }: { value: string }) => (
    <div data-testid="codemirror" data-value={value} />
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";
import {
  SystemPromptDialog,
  selectPromptTurn,
} from "./SystemPromptDialog";
import type { TaskThreadTurn } from "./TaskThreadView";

function turn(partial: Partial<TaskThreadTurn>): TaskThreadTurn {
  return { id: "turn", ...partial };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("selectPromptTurn", () => {
  it("returns the latest turn (by start time) that captured a prompt", () => {
    const result = selectPromptTurn([
      turn({
        id: "old",
        startedAt: "2026-05-28T10:00:00Z",
        systemPrompt: "OLD PROMPT",
      }),
      turn({
        id: "new",
        startedAt: "2026-05-28T11:00:00Z",
        systemPrompt: "NEW PROMPT",
      }),
    ]);
    expect(result?.id).toBe("new");
  });

  it("ignores turns whose prompt is null or whitespace", () => {
    const result = selectPromptTurn([
      turn({ id: "running", startedAt: "2026-05-28T12:00:00Z", systemPrompt: null }),
      turn({ id: "blank", startedAt: "2026-05-28T11:30:00Z", systemPrompt: "   " }),
      turn({ id: "real", startedAt: "2026-05-28T11:00:00Z", systemPrompt: "REAL" }),
    ]);
    expect(result?.id).toBe("real");
  });

  it("returns null when no turn captured a prompt", () => {
    expect(
      selectPromptTurn([turn({ id: "a", systemPrompt: null })]),
    ).toBeNull();
  });
});

describe("SystemPromptDialog", () => {
  it("renders the latest captured prompt read-only", () => {
    render(
      <SystemPromptDialog
        open
        onOpenChange={vi.fn()}
        turns={[
          turn({
            id: "t1",
            startedAt: "2026-05-28T11:00:00Z",
            systemPrompt: "# AGENTS.md\nyou are helpful",
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("codemirror").getAttribute("data-value")).toBe(
      "# AGENTS.md\nyou are helpful",
    );
    expect(screen.queryByTestId("system-prompt-empty")).toBeNull();
  });

  it("shows the earlier prompt when the latest turn is still running (KTD6)", () => {
    render(
      <SystemPromptDialog
        open
        onOpenChange={vi.fn()}
        turns={[
          turn({
            id: "running",
            status: "running",
            startedAt: "2026-05-28T12:00:00Z",
            systemPrompt: null,
          }),
          turn({
            id: "done",
            status: "succeeded",
            startedAt: "2026-05-28T11:00:00Z",
            systemPrompt: "EARLIER PROMPT",
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("codemirror").getAttribute("data-value")).toBe(
      "EARLIER PROMPT",
    );
  });

  it("renders the no-turns empty state", () => {
    render(<SystemPromptDialog open onOpenChange={vi.fn()} turns={[]} />);
    expect(screen.getByTestId("system-prompt-empty").textContent).toMatch(
      /No turns yet/i,
    );
  });

  it("explains capture-on-completion when the latest turn is still running", () => {
    render(
      <SystemPromptDialog
        open
        onOpenChange={vi.fn()}
        turns={[
          turn({
            id: "running",
            status: "running",
            startedAt: "2026-05-28T12:00:00Z",
            systemPrompt: null,
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("system-prompt-empty").textContent).toMatch(
      /still running/i,
    );
  });

  it("reports not-captured when a finished turn has no prompt", () => {
    render(
      <SystemPromptDialog
        open
        onOpenChange={vi.fn()}
        turns={[
          turn({
            id: "failed",
            status: "failed",
            startedAt: "2026-05-28T12:00:00Z",
            systemPrompt: null,
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("system-prompt-empty").textContent).toMatch(
      /No system prompt was captured/i,
    );
  });

  it("copies the prompt and toasts on failure", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <SystemPromptDialog
        open
        onOpenChange={vi.fn()}
        turns={[turn({ id: "t1", startedAt: "2026-05-28T11:00:00Z", systemPrompt: "PROMPT" })]}
      />,
    );

    fireEvent.click(screen.getByTestId("system-prompt-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("PROMPT"));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("system-prompt-copy"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });
});
