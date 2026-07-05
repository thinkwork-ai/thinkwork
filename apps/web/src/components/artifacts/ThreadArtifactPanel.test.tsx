import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { useQueryMock, reexecuteMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  reexecuteMock: vi.fn(),
}));

vi.mock("urql", async (importOriginal) => ({
  ...(await importOriginal<typeof import("urql")>()),
  useQuery: useQueryMock,
  useMutation: () => [{ fetching: false }, vi.fn()],
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a
      href={to.replace(
        /\$(\w+)/g,
        (_match, key: string) => params?.[key] ?? `$${key}`,
      )}
      {...rest}
    >
      {children}
    </a>
  ),
}));

// The body view pulls in the full json-render pipeline — stub it; the panel's
// contract with it is covered by props, not pixels.
vi.mock("@/components/artifacts/ArtifactBodyView", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/artifacts/ArtifactBodyView")
  >()),
  ArtifactBodyView: ({ artifact }: { artifact: { id: string } }) => (
    <div data-testid="artifact-body-stub" data-artifact-id={artifact.id} />
  ),
}));

import { ThreadArtifactPanel } from "./ThreadArtifactPanel";

const canvasArtifact = {
  id: "artifact-1",
  title: "Revenue canvas",
  type: "DATA_VIEW",
  status: "SAVED",
  headVersion: 3,
  content: null,
  metadata: {
    kind: "json_render_canvas",
    stablePartId: "json-render:abc123",
  },
  updatedAt: "2026-07-04T00:00:00.000Z",
  bindings: [],
  versions: [],
};

function mockArtifactQuery(artifact: unknown) {
  useQueryMock.mockReturnValue([
    { data: { artifact }, fetching: false, error: undefined },
    reexecuteMock,
  ]);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("ThreadArtifactPanel", () => {
  it("renders the artifact body, full-page link, and close control", () => {
    mockArtifactQuery(canvasArtifact);
    const onClose = vi.fn();
    render(<ThreadArtifactPanel artifactId="artifact-1" onClose={onClose} />);

    expect(screen.getByTestId("thread-artifact-panel-title").textContent).toBe(
      "Revenue canvas",
    );
    expect(screen.getByTestId("artifact-body-stub").dataset.artifactId).toBe(
      "artifact-1",
    );
    // Full-page deep link stays reachable from the panel header.
    expect(
      screen
        .getByTestId("thread-artifact-panel-full-page")
        .getAttribute("href"),
    ).toBe("/artifacts/artifact-1");

    fireEvent.click(screen.getByTestId("thread-artifact-panel-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("refetches (debounced) when its stable part id bumps on the live stream", () => {
    vi.useFakeTimers();
    mockArtifactQuery(canvasArtifact);
    const { rerender } = render(
      <ThreadArtifactPanel
        artifactId="artifact-1"
        onClose={() => {}}
        jsonRenderPartVersions={new Map()}
      />,
    );
    expect(reexecuteMock).not.toHaveBeenCalled();

    // Same stable part id re-emitted → one debounced network-only refetch.
    rerender(
      <ThreadArtifactPanel
        artifactId="artifact-1"
        onClose={() => {}}
        jsonRenderPartVersions={new Map([["json-render:abc123", 1]])}
      />,
    );
    expect(reexecuteMock).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(reexecuteMock).toHaveBeenCalledTimes(1);
    expect(reexecuteMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });

    // A burst of chunks for the same emission collapses into one refetch.
    rerender(
      <ThreadArtifactPanel
        artifactId="artifact-1"
        onClose={() => {}}
        jsonRenderPartVersions={new Map([["json-render:abc123", 2]])}
      />,
    );
    rerender(
      <ThreadArtifactPanel
        artifactId="artifact-1"
        onClose={() => {}}
        jsonRenderPartVersions={new Map([["json-render:abc123", 3]])}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(reexecuteMock).toHaveBeenCalledTimes(2);
  });

  it("ignores bumps for other part ids", () => {
    vi.useFakeTimers();
    mockArtifactQuery(canvasArtifact);
    const { rerender } = render(
      <ThreadArtifactPanel
        artifactId="artifact-1"
        onClose={() => {}}
        jsonRenderPartVersions={new Map()}
      />,
    );
    rerender(
      <ThreadArtifactPanel
        artifactId="artifact-1"
        onClose={() => {}}
        jsonRenderPartVersions={new Map([["json-render:other", 5]])}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(reexecuteMock).not.toHaveBeenCalled();
  });

  it("shows the not-found fallback when the artifact is missing", () => {
    useQueryMock.mockReturnValue([
      { data: { artifact: null }, fetching: false, error: undefined },
      reexecuteMock,
    ]);
    render(<ThreadArtifactPanel artifactId="artifact-x" onClose={() => {}} />);
    expect(screen.getByText("Artifact not found.")).toBeTruthy();
  });
});
