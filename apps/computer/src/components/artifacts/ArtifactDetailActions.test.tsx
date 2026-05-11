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
  deleteArtifactMock,
  toastSuccessMock,
  toastErrorMock,
  queryDocs,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  deleteArtifactMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  queryDocs: {
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
    warning: (...args: unknown[]) => vi.fn()(...args),
  },
}));

import {
  ArtifactDeleteDialog,
  ArtifactDetailActions,
} from "./ArtifactDetailActions";

beforeEach(() => {
  navigateMock.mockReset();
  deleteArtifactMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  deleteArtifactMock.mockResolvedValue({});
});
afterEach(cleanup);

void toastErrorMock;

describe("ArtifactDetailActions (dropdown trigger)", () => {
  it("renders the overflow trigger accessibly", () => {
    render(
      <ArtifactDetailActions artifactId="art-1" artifactTitle="Demo" />,
    );
    const trigger = screen.getByTestId("artifact-actions-trigger");
    expect(trigger.getAttribute("aria-label")).toBe("Artifact actions");
  });

  it("does not render the favorite/pin menu item (moved to header pin button)", () => {
    render(
      <ArtifactDetailActions artifactId="art-1" artifactTitle="Demo" />,
    );
    expect(screen.queryByTestId("artifact-actions-favorite")).toBeNull();
  });
});

describe("ArtifactDeleteDialog", () => {
  it("renders the destructive confirmation when open", () => {
    render(
      <ArtifactDeleteDialog
        open
        onOpenChange={() => {}}
        artifactId="art-1"
        artifactTitle="Pipeline-risk applet"
      />,
    );
    expect(screen.getByTestId("artifact-delete-dialog")).toBeTruthy();
    expect(screen.getByText(/will be permanently removed/i)).toBeTruthy();
  });

  it("fires deleteArtifact + navigates to /artifacts on confirm", async () => {
    render(
      <ArtifactDeleteDialog
        open
        onOpenChange={() => {}}
        artifactId="art-1"
        artifactTitle="Demo"
      />,
    );
    fireEvent.click(screen.getByTestId("artifact-delete-confirm"));
    await waitFor(() => {
      expect(deleteArtifactMock).toHaveBeenCalledWith({ id: "art-1" });
    });
    expect(navigateMock).toHaveBeenCalledWith({ to: "/artifacts" });
    expect(toastSuccessMock).toHaveBeenCalledWith("Artifact deleted.");
  });

  it("does not fire deleteArtifact when cancel is clicked", async () => {
    const onOpenChange = vi.fn();
    render(
      <ArtifactDeleteDialog
        open
        onOpenChange={onOpenChange}
        artifactId="art-1"
        artifactTitle="Demo"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalled();
    });
    expect(deleteArtifactMock).not.toHaveBeenCalled();
  });
});

