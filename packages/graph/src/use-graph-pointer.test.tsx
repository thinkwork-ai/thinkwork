/**
 * Geometric pointer-handling tests (Living Map bug: canvas node clicks).
 *
 * The regression these pin down: real mice almost always jitter a pixel
 * between pointerdown and pointerup, and the hook treated ANY pointermove
 * during a press as a drag — pinning the node (fx/fy) and suppressing the
 * click, so clicking a node on the canvas never opened the focus sheet.
 * Sub-threshold movement must stay a click; real drags must still drag.
 */
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useGraphPointer,
  DRAG_START_THRESHOLD_PX,
} from "./use-graph-pointer.js";

const NODE_RADIUS = 10;

function makeFg() {
  return {
    // Screen coords == graph coords for these tests (zoom k = 1).
    screen2GraphCoords: (x: number, y: number) => ({ x, y }),
    graph2ScreenCoords: (x: number, y: number) => ({ x, y }),
    zoom: () => 1,
    d3ReheatSimulation: vi.fn(),
  };
}

function Harness({
  fg,
  nodes,
  onNodeClick,
  onBackgroundClick,
  onNodeDoubleClick,
}: {
  fg: any;
  nodes: any[];
  onNodeClick: (node: any) => void;
  onBackgroundClick: () => void;
  onNodeDoubleClick?: (node: any) => void;
}) {
  const [containerEl, setContainerEl] = React.useState<HTMLDivElement | null>(
    null,
  );
  const fgRef = React.useRef<any>(fg);
  const graphDataRef = React.useRef({ nodes });
  useGraphPointer({
    containerEl,
    fgRef,
    graphDataRef,
    nodeRadius: () => NODE_RADIUS,
    tooltipText: (node: any) => String(node.id),
    onNodeClick,
    onBackgroundClick,
    onNodeDoubleClick,
  });
  return (
    <div ref={setContainerEl} data-testid="container">
      <canvas data-testid="canvas" />
    </div>
  );
}

function pointerOpts(x: number, y: number) {
  return {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  };
}

/** jsdom has no PointerEvent — MouseEvent carries everything the hook reads. */
function firePointer(target: EventTarget, type: string, x: number, y: number) {
  target.dispatchEvent(new MouseEvent(type, pointerOpts(x, y)));
}

function setup(
  nodes: any[] = [{ id: "type:person", x: 50, y: 50 }],
  onNodeDoubleClick?: (node: any) => void,
) {
  const fg = makeFg();
  const onNodeClick = vi.fn();
  const onBackgroundClick = vi.fn();
  const view = render(
    <Harness
      fg={fg}
      nodes={nodes}
      onNodeClick={onNodeClick}
      onBackgroundClick={onBackgroundClick}
      onNodeDoubleClick={onNodeDoubleClick}
    />,
  );
  const canvas = view.getByTestId("canvas");
  const container = view.getByTestId("container");
  // jsdom rects are 0x0 at 0,0 — screen coords equal container coords.
  return { fg, onNodeClick, onBackgroundClick, canvas, container, nodes };
}

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("useGraphPointer clicks", () => {
  it("fires onNodeClick for a perfectly still click on a node", () => {
    const { canvas, onNodeClick, nodes } = setup();

    firePointer(canvas, "pointerdown", 50, 50);
    firePointer(window, "pointerup", 50, 50);
    firePointer(canvas, "click", 50, 50);

    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick.mock.calls[0]![0].id).toBe("type:person");
    expect(nodes[0].fx).toBeUndefined();
  });

  it("still clicks through sub-threshold pointer jitter (the real-mouse regression)", () => {
    const { canvas, onNodeClick, nodes, fg } = setup();

    firePointer(canvas, "pointerdown", 50, 50);
    // Chrome delivers micro-jitter as pointermove between down and up.
    firePointer(window, "pointermove", 51, 50);
    firePointer(window, "pointermove", 51, 51);
    firePointer(window, "pointerup", 51, 51);
    firePointer(canvas, "click", 51, 51);

    expect(onNodeClick).toHaveBeenCalledTimes(1);
    // Jitter must not pin the node or reheat the simulation.
    expect(nodes[0].fx).toBeUndefined();
    expect(nodes[0].fy).toBeUndefined();
    expect(fg.d3ReheatSimulation).not.toHaveBeenCalled();
  });

  it("treats movement past the threshold as a drag: pins the node and suppresses the click", () => {
    const { canvas, onNodeClick, nodes, fg } = setup();

    const dragX = 50 + DRAG_START_THRESHOLD_PX + 10;
    firePointer(canvas, "pointerdown", 50, 50);
    firePointer(window, "pointermove", dragX, 50);
    firePointer(window, "pointerup", dragX, 50);
    firePointer(canvas, "click", dragX, 50);

    expect(onNodeClick).not.toHaveBeenCalled();
    expect(nodes[0].fx).toBe(dragX);
    expect(nodes[0].fy).toBe(50);
    expect(fg.d3ReheatSimulation).toHaveBeenCalledTimes(1);
  });

  it("hit-tests the full disc radius, not just the center", () => {
    const { canvas, onNodeClick } = setup();

    // Just inside the disc edge (+4px pointer slop the hook allows).
    firePointer(canvas, "click", 50 + NODE_RADIUS + 3, 50);
    expect(onNodeClick).toHaveBeenCalledTimes(1);
  });

  it("fires onBackgroundClick when the click misses every node", () => {
    const { canvas, onNodeClick, onBackgroundClick } = setup();

    firePointer(canvas, "click", 200, 200);

    expect(onNodeClick).not.toHaveBeenCalled();
    expect(onBackgroundClick).toHaveBeenCalledTimes(1);
  });

  it("clicks ghost candidate nodes exactly like approved nodes", () => {
    const { canvas, onNodeClick } = setup([
      { id: "type:person", kind: "type", x: 50, y: 50 },
      { id: "candidate:item-1", kind: "candidate", x: 120, y: 50 },
    ]);

    firePointer(canvas, "pointerdown", 120, 50);
    firePointer(window, "pointerup", 120, 50);
    firePointer(canvas, "click", 120, 50);

    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick.mock.calls[0]![0].id).toBe("candidate:item-1");
  });
});

describe("useGraphPointer double-click primitive", () => {
  const clickAt = (canvas: EventTarget, x: number, y: number) => {
    firePointer(canvas, "pointerdown", x, y);
    firePointer(window, "pointerup", x, y);
    firePointer(canvas, "click", x, y);
  };

  it("two clicks on the same node within the window fire one dbl-click and two singles", () => {
    const onNodeDoubleClick = vi.fn();
    const { canvas, onNodeClick } = setup(
      [{ id: "type:person", x: 50, y: 50 }],
      onNodeDoubleClick,
    );

    clickAt(canvas, 50, 50);
    clickAt(canvas, 51, 50);

    expect(onNodeClick).toHaveBeenCalledTimes(2);
    expect(onNodeDoubleClick).toHaveBeenCalledTimes(1);
    expect(onNodeDoubleClick.mock.calls[0]![0].id).toBe("type:person");
  });

  it("a third click does not fire a second dbl-click", () => {
    const onNodeDoubleClick = vi.fn();
    const { canvas } = setup(
      [{ id: "type:person", x: 50, y: 50 }],
      onNodeDoubleClick,
    );

    clickAt(canvas, 50, 50);
    clickAt(canvas, 50, 50);
    clickAt(canvas, 50, 50);

    expect(onNodeDoubleClick).toHaveBeenCalledTimes(1);
  });

  it("clicks on different nodes fire singles only", () => {
    const onNodeDoubleClick = vi.fn();
    const { canvas, onNodeClick } = setup(
      [
        { id: "a", x: 50, y: 50 },
        { id: "b", x: 120, y: 50 },
      ],
      onNodeDoubleClick,
    );

    clickAt(canvas, 50, 50);
    clickAt(canvas, 120, 50);

    expect(onNodeClick).toHaveBeenCalledTimes(2);
    expect(onNodeDoubleClick).not.toHaveBeenCalled();
  });

  it("clicks outside the time window fire singles only", () => {
    const onNodeDoubleClick = vi.fn();
    const { canvas } = setup(
      [{ id: "type:person", x: 50, y: 50 }],
      onNodeDoubleClick,
    );

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);
    clickAt(canvas, 50, 50);
    nowSpy.mockReturnValue(1_000 + 301);
    clickAt(canvas, 50, 50);
    nowSpy.mockRestore();

    expect(onNodeDoubleClick).not.toHaveBeenCalled();
  });

  it("drift beyond the threshold between the clicks cancels the dbl-click", () => {
    const onNodeDoubleClick = vi.fn();
    const { canvas } = setup(
      [{ id: "type:person", x: 50, y: 50 }],
      onNodeDoubleClick,
    );

    clickAt(canvas, 50, 50);
    clickAt(canvas, 57, 50);

    expect(onNodeDoubleClick).not.toHaveBeenCalled();
  });

  it("unwired onNodeDoubleClick leaves single-click behavior identical", () => {
    const { canvas, onNodeClick } = setup();

    clickAt(canvas, 50, 50);
    clickAt(canvas, 50, 50);

    expect(onNodeClick).toHaveBeenCalledTimes(2);
  });
});
