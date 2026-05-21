import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@thinkwork/ui";

const { updateArtifactMock, toastSuccessMock, toastErrorMock, queryDocs } =
  vi.hoisted(() => ({
    updateArtifactMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
    queryDocs: {
      UpdateArtifactMutation: Symbol("UpdateArtifactMutation"),
    },
  }));

vi.mock("urql", () => ({
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.UpdateArtifactMutation)
      return [{ fetching: false }, updateArtifactMock];
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

import { PinToggleButton } from "./PinToggleButton";

function renderWithProviders(node: React.ReactNode) {
  return render(<TooltipProvider>{node}</TooltipProvider>);
}

beforeEach(() => {
  updateArtifactMock.mockReset();
  updateArtifactMock.mockResolvedValue({});
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
});
afterEach(cleanup);

describe("PinToggleButton", () => {
  it("renders aria-label 'Pin artifact' when favoritedAt is null", () => {
    renderWithProviders(
      <PinToggleButton artifactId="art-1" favoritedAt={null} />,
    );
    const button = screen.getByTestId("pin-toggle-button");
    expect(button.getAttribute("aria-label")).toBe("Pin artifact");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders aria-label 'Unpin artifact' when favoritedAt is set", () => {
    renderWithProviders(
      <PinToggleButton
        artifactId="art-1"
        favoritedAt="2026-05-10T18:00:00.000Z"
      />,
    );
    const button = screen.getByTestId("pin-toggle-button");
    expect(button.getAttribute("aria-label")).toBe("Unpin artifact");
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking when unpinned fires UpdateArtifactMutation with a fresh ISO timestamp", async () => {
    renderWithProviders(
      <PinToggleButton artifactId="art-1" favoritedAt={null} />,
    );
    fireEvent.click(screen.getByTestId("pin-toggle-button"));
    await waitFor(() => {
      expect(updateArtifactMock).toHaveBeenCalledTimes(1);
    });
    const call = updateArtifactMock.mock.calls[0]?.[0] as {
      id: string;
      input: { favoritedAt: string | null };
    };
    expect(call.id).toBe("art-1");
    expect(call.input.favoritedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(toastSuccessMock).toHaveBeenCalledWith("Pinned.");
  });

  it("clicking when pinned fires UpdateArtifactMutation with favoritedAt: null", async () => {
    renderWithProviders(
      <PinToggleButton
        artifactId="art-2"
        favoritedAt="2026-05-10T18:00:00.000Z"
      />,
    );
    fireEvent.click(screen.getByTestId("pin-toggle-button"));
    await waitFor(() => {
      expect(updateArtifactMock).toHaveBeenCalledWith({
        id: "art-2",
        input: { favoritedAt: null },
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Unpinned.");
  });

  it("surfaces toast.error when the mutation returns an error result", async () => {
    updateArtifactMock.mockResolvedValueOnce({ error: { message: "boom" } });
    renderWithProviders(
      <PinToggleButton artifactId="art-3" favoritedAt={null} />,
    );
    fireEvent.click(screen.getByTestId("pin-toggle-button"));
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        expect.stringContaining("Could not pin artifact: boom"),
      );
    });
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("stops click propagation so parent click handlers don't fire", async () => {
    const parentClick = vi.fn();
    renderWithProviders(
      <div onClick={parentClick}>
        <PinToggleButton artifactId="art-1" favoritedAt={null} />
      </div>,
    );
    fireEvent.click(screen.getByTestId("pin-toggle-button"));
    await waitFor(() => {
      expect(updateArtifactMock).toHaveBeenCalled();
    });
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("respects a custom testId", () => {
    renderWithProviders(
      <PinToggleButton
        artifactId="art-9"
        favoritedAt={null}
        testId="my-custom-pin"
      />,
    );
    expect(screen.getByTestId("my-custom-pin")).toBeTruthy();
    expect(screen.queryByTestId("pin-toggle-button")).toBeNull();
  });
});
