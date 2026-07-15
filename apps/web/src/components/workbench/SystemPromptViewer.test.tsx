import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stub the CodeMirror editor to a plain element so we can assert the bound
// value without driving the real editor in jsdom. Props are captured so the
// wired extensions can be asserted on too.
const codeMirrorProps: Record<string, unknown>[] = [];
vi.mock("@uiw/react-codemirror", () => ({
  default: (props: { value: string }) => {
    codeMirrorProps.push(props);
    return <div data-testid="codemirror" data-value={props.value} />;
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";
import { editorSelectionHighlight } from "@thinkwork/workspace-editor";
import { SystemPromptViewer } from "./SystemPromptViewer";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  codeMirrorProps.length = 0;
});

describe("SystemPromptViewer", () => {
  it("renders the provided prompt read-only", () => {
    render(<SystemPromptViewer prompt={"# AGENTS.md\nyou are helpful"} />);
    expect(screen.getByTestId("codemirror").getAttribute("data-value")).toBe(
      "# AGENTS.md\nyou are helpful",
    );
  });

  it("wires the shared selection highlight while staying read-only (THINK-296 AE3)", () => {
    render(<SystemPromptViewer prompt="select me to copy" />);
    expect(codeMirrorProps.length).toBeGreaterThan(0);
    const props = codeMirrorProps[0];
    expect(props.readOnly).toBe(true);
    expect(props.extensions as unknown[]).toContain(editorSelectionHighlight);
  });

  it("renders nothing when the prompt is empty (caller owns the empty state)", () => {
    const { container } = render(<SystemPromptViewer prompt="" />);
    expect(screen.queryByTestId("codemirror")).toBeNull();
    expect(screen.queryByTestId("system-prompt-copy")).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("renders a very large prompt without throwing (highlighting dropped past the cap)", () => {
    const big = "x".repeat(60_000);
    render(<SystemPromptViewer prompt={big} />);
    expect(screen.getByTestId("codemirror").getAttribute("data-value")).toBe(
      big,
    );
  });

  it("copies the exact prompt and toasts success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<SystemPromptViewer prompt="PROMPT" copyToastLabel="Copied." />);

    fireEvent.click(screen.getByTestId("system-prompt-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("PROMPT"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Copied."));
  });

  it("toasts an error when the clipboard write is rejected", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<SystemPromptViewer prompt="PROMPT" />);

    fireEvent.click(screen.getByTestId("system-prompt-copy"));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });
});
