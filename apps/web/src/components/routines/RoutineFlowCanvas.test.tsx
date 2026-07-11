import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

let flowProps: Record<string, unknown> | null = null;
const fitViewMock = vi.fn();

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: Record<string, unknown>) => {
    flowProps = props;
    (
      props.onInit as
        | ((instance: { fitView: typeof fitViewMock }) => void)
        | undefined
    )?.({
      fitView: fitViewMock,
    });
    return <div data-testid="react-flow">{props.children as ReactNode}</div>;
  },
  Background: () => null,
  Controls: () => null,
}));

vi.mock("@thinkwork/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@thinkwork/ui")>("@thinkwork/ui");
  return { ...actual, useTheme: () => ({ theme: "dark" }) };
});

import { RoutineFlowCanvas } from "./RoutineFlowCanvas";

afterEach(() => {
  cleanup();
  flowProps = null;
  fitViewMock.mockReset();
  vi.unstubAllGlobals();
});

describe("RoutineFlowCanvas", () => {
  it("caps automatic fit at authored node size while retaining manual zoom", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    render(
      <RoutineFlowCanvas
        mode="execution"
        aslJson={null}
        graph={{
          nodes: [
            {
              id: "step-1",
              stateName: "step-1",
              label: "Step",
              kind: "agent",
              position: { x: 0, y: 0 },
              width: 230,
              height: 86,
            },
          ],
          edges: [],
        }}
      />,
    );

    expect(flowProps?.fitView).toBe(true);
    expect(flowProps?.fitViewOptions).toEqual({ padding: 0.18, maxZoom: 1 });
    expect(flowProps?.maxZoom).toBe(1.4);
    expect(fitViewMock).toHaveBeenCalledWith({ padding: 0.18, maxZoom: 1 });
  });
});
