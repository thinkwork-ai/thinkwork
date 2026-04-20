import {
  type Simulation,
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";
import { useEffect, useRef, useState } from "react";
import type { WikiGraphEdge, WikiGraphNode } from "../types";

const TARGET_TICK_HZ = 30;
const FRAME_BUDGET_MS = 1000 / TARGET_TICK_HZ;
const QUIESCE_ALPHA = 0.01;

export interface UseForceSimulationResult {
  tick: number;
  restart: (alpha?: number) => void;
  stop: () => void;
}

/**
 * Runs a d3-force simulation against the given nodes/edges. Mutates
 * `node.x` / `node.y` in place. Triggers React re-renders at ~30Hz via
 * a tick counter so the JS thread isn't pinned by every sim tick.
 *
 * Auto-stops once `alpha < 0.01` holds.
 */
export function useForceSimulation(
  nodes: WikiGraphNode[],
  edges: WikiGraphEdge[],
): UseForceSimulationResult {
  const [tick, setTick] = useState(0);
  const simRef = useRef<Simulation<WikiGraphNode, WikiGraphEdge> | null>(null);
  const lastRenderRef = useRef(0);

  useEffect(() => {
    // Tuned for dense agent graphs (~50–150 pages). Goals:
    //   - shorter links + softer charge → connected neighborhoods stay tight
    //   - forceX/forceY pull stragglers toward center so disconnected
    //     components don't drift far off-canvas
    //   - tighter collide so nodes pack densely without overlapping
    const sim = forceSimulation<WikiGraphNode, WikiGraphEdge>(nodes)
      .force(
        "link",
        forceLink<WikiGraphNode, WikiGraphEdge>(edges)
          .id((d) => d.id)
          .distance(40),
      )
      .force("charge", forceManyBody().strength(-80))
      .force("center", forceCenter(0, 0))
      .force("x", forceX(0).strength(0.08))
      .force("y", forceY(0).strength(0.08))
      .force("collide", forceCollide(18));

    simRef.current = sim;

    sim.on("tick", () => {
      const now = Date.now();
      if (now - lastRenderRef.current < FRAME_BUDGET_MS) return;
      lastRenderRef.current = now;
      setTick((t) => t + 1);
      if (sim.alpha() < QUIESCE_ALPHA) {
        sim.stop();
      }
    });

    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [nodes, edges]);

  return {
    tick,
    restart: (alpha = 0.3) => {
      simRef.current?.alpha(alpha).restart();
    },
    stop: () => {
      simRef.current?.stop();
    },
  };
}
