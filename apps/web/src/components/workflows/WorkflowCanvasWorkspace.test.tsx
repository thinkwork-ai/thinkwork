import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowCanvasWorkspace } from "./WorkflowCanvasWorkspace";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockViewport(wide: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: wide,
    media: "(min-width: 1536px)",
    addEventListener: vi.fn((_event: string, listener: () => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_event: string, listener: () => void) => {
      listeners.delete(listener);
    }),
    dispatch(next: boolean) {
      query.matches = next;
      listeners.forEach((listener) => listener());
    },
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => query),
  );
  return query;
}

describe("WorkflowCanvasWorkspace", () => {
  it("renders source-owned canvas and inspector content in one shared shell", () => {
    mockViewport(false);
    const { container } = render(
      <WorkflowCanvasWorkspace
        canvas={<div>Automation graph</div>}
        inspector={<aside>General information</aside>}
      />,
    );

    expect(screen.getByText("Automation graph")).toBeTruthy();
    expect(screen.queryByText("General information")).toBeNull();
    expect(container.firstElementChild?.className).not.toContain("@container");

    fireEvent.click(
      screen.getByRole("button", { name: "Open inspector panel" }),
    );
    expect(screen.getByText("General information")).toBeTruthy();
    expect(screen.getByTestId("workflow-inspector-panel")).toBeTruthy();
  });

  it("opens the side sheet when a canvas node becomes selected", () => {
    mockViewport(false);
    const { rerender } = render(
      <WorkflowCanvasWorkspace
        canvas={<div>Automation graph</div>}
        inspector={<aside>Work step</aside>}
        inspectorKey={null}
      />,
    );

    rerender(
      <WorkflowCanvasWorkspace
        canvas={<div>Automation graph</div>}
        inspector={<aside>Work step</aside>}
        inspectorKey="work"
      />,
    );

    expect(screen.getByTestId("workflow-inspector-panel")).toBeTruthy();
    expect(screen.getByText("Work step")).toBeTruthy();
  });

  it("switches between a side sheet and fixed inspector as the viewport changes", () => {
    const viewport = mockViewport(false);
    render(
      <WorkflowCanvasWorkspace
        canvas={<div>Automation graph</div>}
        inspector={<aside>General information</aside>}
      />,
    );

    expect(screen.queryByTestId("workflow-fixed-inspector")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Open inspector panel" }),
    );
    expect(screen.getByTestId("workflow-inspector-panel")).toBeTruthy();

    act(() => viewport.dispatch(true));

    expect(screen.queryByTestId("workflow-inspector-panel")).toBeNull();
    expect(screen.getByTestId("workflow-fixed-inspector")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Open inspector panel" }),
    ).toBeNull();
  });
});
