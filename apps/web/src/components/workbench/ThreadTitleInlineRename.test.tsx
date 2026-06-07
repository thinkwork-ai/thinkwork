import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { UpdateThreadMutation } from "@/lib/graphql-queries";
import { ThreadTitleInlineRename } from "./ThreadTitleInlineRename";

const updateThreadMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/graphql-queries", () => ({
  UpdateThreadMutation: Symbol("UpdateThreadMutation"),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("urql", () => ({
  useMutation: (mutation: unknown) => {
    if (mutation === UpdateThreadMutation) {
      return [{ fetching: false }, updateThreadMock];
    }
    return [{ fetching: false }, vi.fn()];
  },
}));

vi.mock("@thinkwork/ui", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  ContextMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ContextMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  ContextMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ContextMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: (event: Event) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onSelect?.({ preventDefault: vi.fn() } as unknown as Event)
      }
    >
      {children}
    </button>
  ),
}));

beforeEach(() => {
  updateThreadMock.mockReset();
  updateThreadMock.mockResolvedValue({ data: { updateThread: { id: "t-1" } } });
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.success).mockReset();
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  };
  window.cancelAnimationFrame = vi.fn();
});

afterEach(cleanup);

describe("ThreadTitleInlineRename", () => {
  it("renames a thread title from the context menu", async () => {
    const onRenamed = vi.fn();
    const onEvent = vi.fn();
    window.addEventListener("thinkwork:thread-renamed", onEvent);

    render(
      <ThreadTitleInlineRename
        threadId="thread-1"
        title="Old title"
        onRenamed={onRenamed}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    const input = await screen.findByRole("textbox", {
      name: /rename thread title/i,
    });
    fireEvent.change(input, { target: { value: "  New title  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(updateThreadMock).toHaveBeenCalledWith({
        id: "thread-1",
        input: { title: "New title" },
      }),
    );
    expect(onRenamed).toHaveBeenCalledWith("New title");
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Thread renamed.");

    window.removeEventListener("thinkwork:thread-renamed", onEvent);
  });

  it("rejects blank titles without calling the mutation", async () => {
    render(<ThreadTitleInlineRename threadId="thread-1" title="Old title" />);

    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    const input = await screen.findByRole("textbox", {
      name: /rename thread title/i,
    });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Thread title can't be blank.");
    });
    expect(updateThreadMock).not.toHaveBeenCalled();
    expect(screen.getByText("Old title")).toBeTruthy();
  });

  it("cancels editing on Escape", async () => {
    render(<ThreadTitleInlineRename threadId="thread-1" title="Old title" />);

    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    const input = await screen.findByRole("textbox", {
      name: /rename thread title/i,
    });
    fireEvent.change(input, { target: { value: "Ignored" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(updateThreadMock).not.toHaveBeenCalled();
    expect(screen.getByText("Old title")).toBeTruthy();
  });
});
