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

function mockWorkspaceWidth(initialWidth: number, wideLeading = false) {
  let callback: ResizeObserverCallback | null = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(next: ResizeObserverCallback) {
        callback = next;
      }

      observe(target: Element) {
        dispatch(initialWidth, target);
      }

      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: wideLeading })),
  );

  function dispatch(width: number, target: Element = document.body) {
    callback?.(
      [
        {
          target,
          contentRect: { width },
        } as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    );
  }

  return { dispatch };
}

describe("WorkflowCanvasWorkspace", () => {
  it("renders source-owned canvas and inspector content in one shared shell", () => {
    mockWorkspaceWidth(700);
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
    mockWorkspaceWidth(700);
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
    const workspace = mockWorkspaceWidth(700);
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

    act(() => workspace.dispatch(701));

    expect(screen.queryByTestId("workflow-inspector-panel")).toBeNull();
    expect(screen.getByTestId("workflow-fixed-inspector")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Open inspector panel" }),
    ).toBeNull();
  });

  it("keeps 700 pixels for the canvas before fixing the inspector", () => {
    const workspace = mockWorkspaceWidth(700);
    render(
      <WorkflowCanvasWorkspace
        canvas={<div>Automation graph</div>}
        inspector={<aside>General information</aside>}
      />,
    );

    expect(screen.queryByTestId("workflow-fixed-inspector")).toBeNull();

    act(() => workspace.dispatch(701));

    const fixedInspector = screen.getByTestId("workflow-fixed-inspector");
    expect(fixedInspector.className).not.toContain("p-4");
    expect(fixedInspector.className).not.toContain("border");
    expect(fixedInspector.className).not.toContain("bg-card");
  });

  it("accounts for the executions list before fixing the inspector", () => {
    const workspace = mockWorkspaceWidth(936, true);
    render(
      <WorkflowCanvasWorkspace
        leading={<aside>Executions</aside>}
        canvas={<div>Automation graph</div>}
        inspector={<aside>Execution information</aside>}
      />,
    );

    expect(screen.queryByTestId("workflow-fixed-inspector")).toBeNull();

    act(() => workspace.dispatch(937));

    expect(screen.getByTestId("workflow-fixed-inspector")).toBeTruthy();
  });
});
