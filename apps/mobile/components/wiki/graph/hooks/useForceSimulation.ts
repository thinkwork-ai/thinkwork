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
  /**
   * d3-force alpha decay per tick. Omit to use d3's default (~0.0228,
   * which takes ~170 ticks from alpha=0.5 down to the hook's 0.01
   * quiesce gate). Raise (e.g. 0.06) to cool the sim faster when the
   * layout only needs to re-balance from seeded positions rather than
   * cold-spread from a random seed.
   */
  alphaDecay?: number;
  /**
   * d3-force velocity decay (damping). Omit to use d3's default (0.4).
   * Raise (e.g. 0.55) to damp per-tick motion more aggressively so
   * nodes settle visually before alpha even reaches the quiesce gate.
   * NOTE: raising this too far (>0.5) degrades clustering because
   * nodes get damped before they can pack into their force equilibrium.
   */
  velocityDecay?: number;
  /**
   * Alpha threshold at which this hook stops the sim + flags `settled`.
   * Omit to use the hook's default (0.01, d3-ish "fully converged").
   * Raise (e.g. 0.05) to end the animation once visible motion is
   * already tiny — the tail from alpha≈0.05 down to 0.01 is mostly
   * CPU work the user can't see, and cutting it off is the cheapest
   * way to shorten a re-layout animation without changing the
   * steady-state layout.
   */
  quiesceAlpha?: number;
}

export interface UseForceSimulationResult {
  tick: number;
  settled: boolean;
  /**
   * Re-heats the sim to the given alpha and starts the scheduler. When
   * `preTick > 0`, runs that many iterations synchronously *before* the
   * scheduler starts — d3's `simulation.tick(N)` advances the sim without
   * emitting tick events, so positions converge offscreen and the user
   * only sees the trailing low-amplitude settle. Essential when a re-
   * layout has to transition between dramatically different force
   * equilibriums (e.g. a label-mode toggle) that would otherwise not
   * converge within the visible tick budget.
   */
  restart: (alpha?: number, preTick?: number) => void;
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
    linkDistance = 60,
    chargeStrength = -130,
    collideRadius = 22,
    xyStrength = 0.08,
    alphaDecay,
    velocityDecay,
    quiesceAlpha = QUIESCE_ALPHA,
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

    // Apply cooling knobs only when the caller opts in. Omitting them
    // leaves d3's defaults (alphaDecay ≈ 0.0228, velocityDecay = 0.4),
    // so existing callers keep the exact same feel.
    if (typeof alphaDecay === "number") sim.alphaDecay(alphaDecay);
    if (typeof velocityDecay === "number") sim.velocityDecay(velocityDecay);

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
      if (sim.alpha() < quiesceAlpha) {
        sim.stop();
        setSettled(true);
      }
    });

    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [
    nodes,
    edges,
    linkDistance,
    chargeStrength,
    collideRadius,
    xyStrength,
    alphaDecay,
    velocityDecay,
    quiesceAlpha,
  ]);

  return {
    tick,
    settled,
    restart: (alpha = 0.3, preTick = 0) => {
      setSettled(false);
      const sim = simRef.current;
      if (!sim) return;
      sim.alpha(alpha);
      // Fast-forward convergence offscreen. `sim.tick(N)` advances the
      // forces without firing tick events, so no re-renders happen
      // during the pre-tick. The JS thread blocks briefly (~2-4ms/tick
      // on ~150 nodes) but the user never sees it — they just see the
      // final low-amplitude tail once `restart()` starts the scheduler.
      if (preTick > 0) sim.tick(preTick);
      sim.restart();
    },
    stop: () => {
      simRef.current?.stop();
    },
  };
}
