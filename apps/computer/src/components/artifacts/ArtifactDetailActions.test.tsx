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
  updateArtifactMock,
  deleteArtifactMock,
  toastSuccessMock,
  toastErrorMock,
  queryDocs,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  updateArtifactMock: vi.fn(),
  deleteArtifactMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  queryDocs: {
    UpdateArtifactMutation: Symbol("UpdateArtifactMutation"),
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
    if (doc === queryDocs.UpdateArtifactMutation)
      return [{ fetching: false }, updateArtifactMock];
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
  updateArtifactMock.mockReset();
  deleteArtifactMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  updateArtifactMock.mockResolvedValue({});
  deleteArtifactMock.mockResolvedValue({});
});
afterEach(cleanup);

void toastErrorMock;

describe("ArtifactDetailActions (dropdown trigger)", () => {
  it("renders the overflow trigger accessibly", () => {
    render(
      <ArtifactDetailActions
        artifactId="art-1"
        artifactTitle="Demo"
        favoritedAt={null}
      />,
    );
    const trigger = screen.getByTestId("artifact-actions-trigger");
    expect(trigger.getAttribute("aria-label")).toBe("Artifact actions");
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
        favoritedAt={null}
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
        favoritedAt={null}
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
        favoritedAt={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalled();
    });
    expect(deleteArtifactMock).not.toHaveBeenCalled();
  });
});

// Hooked-into-mock test for the favorite-toggle handler. The dropdown
// menu interaction needs a portal that jsdom + Radix don't open via
// click(), so we extract the menu-content render path is exercised by
// ArtifactActionsMenu's onSelect handler when the user picks the item.
// We can't easily reach the menu items in jsdom, but we can verify the
// trigger is wired up. The actual favorite mutation is covered by the
// graphql-level tests in packages/api/src/__tests__/artifact-resolvers-
// payloads.test.ts (favoritedAt set/clear/untouched cases).
