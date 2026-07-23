import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  navigateMock,
  updateThreadMock,
  deleteThreadMock,
  deleteArtifactMock,
  pinThreadMock,
  unpinThreadMock,
  toastSuccessMock,
  toastErrorMock,
  toastWarningMock,
  queryDocs,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  updateThreadMock: vi.fn(),
  deleteThreadMock: vi.fn(),
  deleteArtifactMock: vi.fn(),
  pinThreadMock: vi.fn(),
  unpinThreadMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastWarningMock: vi.fn(),
  queryDocs: {
    UpdateThreadMutation: Symbol("UpdateThreadMutation"),
    DeleteThreadMutation: Symbol("DeleteThreadMutation"),
    DeleteArtifactMutation: Symbol("DeleteArtifactMutation"),
    PinThreadMutation: Symbol("PinThreadMutation"),
    UnpinThreadMutation: Symbol("UnpinThreadMutation"),
  },
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("urql", () => ({
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.UpdateThreadMutation)
      return [{ fetching: false }, updateThreadMock];
    if (doc === queryDocs.DeleteThreadMutation)
      return [{ fetching: false }, deleteThreadMock];
    if (doc === queryDocs.DeleteArtifactMutation)
      return [{ fetching: false }, deleteArtifactMock];
    if (doc === queryDocs.PinThreadMutation)
      return [{ fetching: false }, pinThreadMock];
    if (doc === queryDocs.UnpinThreadMutation)
      return [{ fetching: false }, unpinThreadMock];
    return [{ fetching: false }, vi.fn()];
  },
}));

vi.mock("@/lib/graphql-queries", () => queryDocs);

// Keep every @thinkwork/ui primitive real (the delete-dialog tests below rely
// on the real AlertDialog/Checkbox), but render the Radix dropdown's content
// inline so menu items are assertable without driving pointer events in jsdom.
vi.mock("@thinkwork/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@thinkwork/ui")>("@thinkwork/ui");
  const Pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    ...actual,
    DropdownMenu: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuTrigger: ({
      children,
      asChild,
    }: {
      children: React.ReactNode;
      asChild?: boolean;
    }) => (asChild ? children : <button type="button">{children}</button>),
    DropdownMenuItem: ({
      children,
      onSelect,
      disabled,
      asChild,
      ...props
    }: {
      children: React.ReactNode;
      onSelect?: (event: { preventDefault: () => void }) => void;
      disabled?: boolean;
      asChild?: boolean;
    }) =>
      asChild ? (
        children
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelect?.({ preventDefault: () => {} })}
          {...props}
        >
          {children}
        </button>
      ),
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
    warning: (...args: unknown[]) => toastWarningMock(...args),
  },
}));

import { ThreadDeleteDialog, ThreadDetailActions } from "./ThreadDetailActions";

beforeEach(() => {
  navigateMock.mockReset();
  updateThreadMock.mockReset();
  deleteThreadMock.mockReset();
  deleteArtifactMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  toastWarningMock.mockReset();
  updateThreadMock.mockResolvedValue({});
  deleteThreadMock.mockResolvedValue({});
  deleteArtifactMock.mockResolvedValue({});
});
afterEach(cleanup);

// Reference toastErrorMock to keep the mock wired even before an
// error-path test reads from it (avoids the eslint unused-binding pass).
void toastErrorMock;

describe("ThreadDetailActions (dropdown trigger)", () => {
  it("renders the overflow trigger button accessibly", () => {
    render(
      <ThreadDetailActions
        threadId="t1"
        tenantId="t1"
        threadTitle="Map runbook smoke"
        attachedArtifacts={[]}
      />,
    );
    const trigger = screen.getByTestId("thread-actions-trigger");
    expect(trigger.getAttribute("aria-label")).toBe("Thread actions");
    expect(trigger.className).toContain("text-muted-foreground/70");
  });

  it("offers Pin/Rename/Archive/Delete but no System Prompt item", () => {
    render(
      <ThreadDetailActions
        threadId="t1"
        tenantId="t1"
        threadTitle="Map runbook smoke"
        attachedArtifacts={[]}
      />,
    );
    expect(screen.getByText("Pin thread")).toBeTruthy();
    expect(screen.getByText("Rename thread")).toBeTruthy();
    expect(screen.getByText("Archive thread")).toBeTruthy();
    expect(screen.getByText("Delete thread")).toBeTruthy();
    // The System Prompt item moved to the operator execution trace (U3).
    expect(screen.queryByText("System Prompt")).toBeNull();
    expect(screen.queryByTestId("thread-actions-system-prompt")).toBeNull();
  });
});

describe("ThreadDeleteDialog cascade flow", () => {
  it("renders no cascade notice when there are zero attached artifacts", () => {
    render(
      <ThreadDeleteDialog
        open
        onOpenChange={() => {}}
        threadId="t1"
        tenantId="t1"
        threadTitle="Empty"
        attachedArtifacts={[]}
      />,
    );
    expect(screen.queryByTestId("thread-delete-cascade-notice")).toBeNull();
  });

  it("renders singular cascade notice for one attached artifact", () => {
    render(
      <ThreadDeleteDialog
        open
        onOpenChange={() => {}}
        threadId="t1"
        tenantId="t1"
        threadTitle="Solo"
        attachedArtifacts={[{ id: "a1", title: "Only one" }]}
      />,
    );
    expect(
      screen.getByText(
        "The 1 artifact linked to this thread will be deleted as well.",
      ),
    ).toBeTruthy();
  });

  it("renders plural cascade notice for many attached artifacts", () => {
    render(
      <ThreadDeleteDialog
        open
        onOpenChange={() => {}}
        threadId="t1"
        tenantId="t1"
        threadTitle="Busy"
        attachedArtifacts={[
          { id: "a1", title: "One" },
          { id: "a2", title: "Two" },
          { id: "a3", title: "Three" },
        ]}
      />,
    );
    expect(
      screen.getByText(
        "The 3 artifacts linked to this thread will be deleted as well.",
      ),
    ).toBeTruthy();
  });

  it("deletes via the single thread mutation (server cascades artifacts)", async () => {
    render(
      <ThreadDeleteDialog
        open
        onOpenChange={() => {}}
        threadId="t1"
        tenantId="t1"
        threadTitle="Busy"
        attachedArtifacts={[
          { id: "a1", title: "One" },
          { id: "a2", title: "Two" },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("thread-delete-confirm"));
    await waitFor(() => {
      expect(deleteThreadMock).toHaveBeenCalledWith({ id: "t1" });
    });
    expect(deleteArtifactMock).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith({ to: "/new" });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Thread deleted along with 2 artifacts.",
    );
  });

  it("delegates post-delete selection without navigating to the threads index", async () => {
    const onDeleted = vi.fn();
    render(
      <ThreadDeleteDialog
        open
        onOpenChange={() => {}}
        threadId="t1"
        tenantId="t1"
        threadTitle="Busy"
        attachedArtifacts={[]}
        onDeleted={onDeleted}
      />,
    );

    fireEvent.click(screen.getByTestId("thread-delete-confirm"));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith("t1");
    });
    expect(navigateMock).not.toHaveBeenCalledWith({ to: "/threads" });
  });

  it("Cancel button closes the dialog without firing destructive mutations", async () => {
    const onOpenChange = vi.fn();
    render(
      <ThreadDeleteDialog
        open
        onOpenChange={onOpenChange}
        threadId="t1"
        tenantId="t1"
        threadTitle="Cancellable"
        attachedArtifacts={[{ id: "a1", title: "x" }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // Radix forwards the close through onOpenChange(false).
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalled();
    });
    expect(onOpenChange.mock.calls.some((c) => c[0] === false)).toBe(true);
    expect(deleteThreadMock).not.toHaveBeenCalled();
    expect(deleteArtifactMock).not.toHaveBeenCalled();
    expect(updateThreadMock).not.toHaveBeenCalled();
  });
});
