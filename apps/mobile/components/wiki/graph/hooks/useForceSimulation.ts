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

export interface SimConfig {
  /** d3-force link distance. Default 40 (dense agent graphs). */
  linkDistance?: number;
  /** d3-force charge strength. Default -80. More negative = more repulsion. */
  chargeStrength?: number;
  /** d3-force collide radius. Default 18. */
  collideRadius?: number;
  /** forceX/forceY strength pulling stragglers to origin. Default 0.08. */
  xyStrength?: number;
}

export interface UseForceSimulationResult {
  tick: number;
  settled: boolean;
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
  config: SimConfig = {},
): UseForceSimulationResult {
  const {
    linkDistance = 40,
    chargeStrength = -80,
    collideRadius = 18,
    xyStrength = 0.08,
  } = config;
  const [tick, setTick] = useState(0);
  const [settled, setSettled] = useState(false);
  const simRef = useRef<Simulation<WikiGraphNode, WikiGraphEdge> | null>(null);
  const lastRenderRef = useRef(0);

  useEffect(() => {
    // If every node arrives with a non-NaN position (e.g. restored from
    // cache), start the sim quiesced so d3's default alpha=1 doesn't
    // agitate the pre-seeded layout. Users can still restart() later.
    const preseeded =
      nodes.length > 0 &&
      nodes.every(
        (n) => typeof n.x === "number" && typeof n.y === "number",
      );

    setSettled(preseeded);
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
          .distance(linkDistance),
      )
      .force("charge", forceManyBody().strength(chargeStrength))
      .force("center", forceCenter(0, 0))
      .force("x", forceX(0).strength(xyStrength))
      .force("y", forceY(0).strength(xyStrength))
      .force("collide", forceCollide(collideRadius));

    if (preseeded) {
      // Freeze at the restored layout. `alpha(0)` + `stop()` means no
      // ticks will fire; nodes remain at their seeded positions.
      sim.alpha(0);
      sim.stop();
    }

    simRef.current = sim;

    sim.on("tick", () => {
      const now = Date.now();
      if (now - lastRenderRef.current < FRAME_BUDGET_MS) return;
      lastRenderRef.current = now;
      setTick((t) => t + 1);
      if (sim.alpha() < QUIESCE_ALPHA) {
        sim.stop();
        setSettled(true);
      }
    });

    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [nodes, edges, linkDistance, chargeStrength, collideRadius, xyStrength]);

  return {
    tick,
    settled,
    restart: (alpha = 0.3) => {
      setSettled(false);
      simRef.current?.alpha(alpha).restart();
    },
    stop: () => {
      simRef.current?.stop();
    },
  };
}
