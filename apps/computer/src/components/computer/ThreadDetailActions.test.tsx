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
  toastSuccessMock,
  toastErrorMock,
  toastWarningMock,
  queryDocs,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  updateThreadMock: vi.fn(),
  deleteThreadMock: vi.fn(),
  deleteArtifactMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastWarningMock: vi.fn(),
  queryDocs: {
    UpdateThreadMutation: Symbol("UpdateThreadMutation"),
    DeleteThreadMutation: Symbol("DeleteThreadMutation"),
    DeleteArtifactMutation: Symbol("DeleteArtifactMutation"),
  },
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>(
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
    return [{ fetching: false }, vi.fn()];
  },
}));

vi.mock("@/lib/graphql-queries", () => queryDocs);

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
    warning: (...args: unknown[]) => toastWarningMock(...args),
  },
}));

import {
  ThreadDeleteDialog,
  ThreadDetailActions,
} from "./ThreadDetailActions";

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
        threadTitle="Map runbook smoke"
        attachedArtifacts={[]}
      />,
    );
    const trigger = screen.getByTestId("thread-actions-trigger");
    expect(trigger.getAttribute("aria-label")).toBe("Thread actions");
  });
});

describe("ThreadDeleteDialog cascade flow", () => {
  it("renders no cascade checkbox when there are zero attached artifacts", () => {
    render(
      <ThreadDeleteDialog
        open
        onOpenChange={() => {}}
        threadId="t1"
        threadTitle="Empty"
        attachedArtifacts={[]}
      />,
    );
    expect(screen.queryByTestId("thread-delete-cascade")).toBeNull();
  });

  it("renders singular cascade label for one attached artifact", () => {
    render(
      <ThreadDeleteDialog
        open
        onOpenChange={() => {}}
        threadId="t1"
        threadTitle="Solo"
        attachedArtifacts={[{ id: "a1", title: "Only one" }]}
      />,
    );
    expect(
      screen.getByText("Also delete the 1 attached artifact."),
    ).toBeTruthy();
  });

  it("renders plural cascade label for many attached artifacts", () => {
    render(
      <ThreadDeleteDialog
        open
        onOpenChange={() => {}}
        threadId="t1"
        threadTitle="Busy"
        attachedArtifacts={[
          { id: "a1", title: "One" },
          { id: "a2", title: "Two" },
          { id: "a3", title: "Three" },
        ]}
      />,
    );
    expect(
      screen.getByText("Also delete the 3 attached artifacts."),
    ).toBeTruthy();
  });

  it("deletes only the thread when cascade checkbox is unset", async () => {
    render(
      <ThreadDeleteDialog
        open
        onOpenChange={() => {}}
        threadId="t1"
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
    expect(navigateMock).toHaveBeenCalledWith({ to: "/threads" });
    expect(toastSuccessMock).toHaveBeenCalledWith("Thread deleted.");
  });

  it("deletes thread + each attached artifact when cascade is set", async () => {
    render(
      <ThreadDeleteDialog
        open
        onOpenChange={() => {}}
        threadId="t1"
        threadTitle="Busy"
        attachedArtifacts={[
          { id: "a1", title: "One" },
          { id: "a2", title: "Two" },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("thread-delete-cascade"));
    fireEvent.click(screen.getByTestId("thread-delete-confirm"));

    await waitFor(() => {
      expect(deleteThreadMock).toHaveBeenCalledWith({ id: "t1" });
    });
    expect(deleteArtifactMock).toHaveBeenCalledTimes(2);
    expect(deleteArtifactMock).toHaveBeenCalledWith({ id: "a1" });
    expect(deleteArtifactMock).toHaveBeenCalledWith({ id: "a2" });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Thread deleted along with 2 artifacts.",
    );
  });

  it("surfaces a partial-failure toast when one artifact delete fails", async () => {
    deleteArtifactMock
      .mockResolvedValueOnce({ error: new Error("boom") })
      .mockResolvedValueOnce({});
    render(
      <ThreadDeleteDialog
        open
        onOpenChange={() => {}}
        threadId="t1"
        threadTitle="Busy"
        attachedArtifacts={[
          { id: "a1", title: "One" },
          { id: "a2", title: "Two" },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("thread-delete-cascade"));
    fireEvent.click(screen.getByTestId("thread-delete-confirm"));

    await waitFor(() => {
      expect(deleteThreadMock).toHaveBeenCalled();
    });
    expect(toastWarningMock).toHaveBeenCalled();
    const warningArg = toastWarningMock.mock.calls[0][0] as string;
    expect(warningArg).toContain("1 of 2");
  });

  it("Cancel button closes the dialog without firing destructive mutations", async () => {
    const onOpenChange = vi.fn();
    render(
      <ThreadDeleteDialog
        open
        onOpenChange={onOpenChange}
        threadId="t1"
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
