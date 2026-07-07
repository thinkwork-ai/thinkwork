/**
 * Scale validation for THINK-212 U6: the pure-logic pipeline must stay
 * interactive at a mature-tenant graph size (~10k nodes / ~50k edges).
 * FPS/interaction measurements can't run in jsdom — those are captured
 * manually on the dev stage and documented in the PR.
 */
import { describe, expect, it } from "vitest";
import {
  computeCommunityAnchors,
  detectCommunities,
  expandNeighborhood,
  initialCameraZ,
  DEFAULT_FOCUS_CAP,
  DEFAULT_FOCUS_DEGREE,
} from "./graph-utils.js";
import { generateSyntheticGraph } from "./synthetic-graph.js";

const graph = generateSyntheticGraph();

describe("scale validation at 10k nodes / ~50k edges", () => {
  it("generates the expected scale", () => {
    expect(graph.nodes.length).toBe(10000);
    expect(graph.links.length).toBeGreaterThan(40000);
  });

  it("community detection completes under 1s", () => {
    const start = performance.now();
    const communities = detectCommunities(graph.nodes, graph.links);
    const elapsed = performance.now() - start;
    // eslint-disable-next-line no-console
    console.info(
      `detectCommunities(10k/${graph.links.length}): ${elapsed.toFixed(0)}ms`,
    );
    expect(communities.size).toBe(10000);
    expect(elapsed).toBeLessThan(1000);
  });

  it("neighborhood expansion completes under 50ms, including a hub", () => {
    const start = performance.now();
    // n0 is a community hub with ~120 fanout — the worst case for focus.
    const hub = expandNeighborhood(
      ["n0"],
      graph.links,
      DEFAULT_FOCUS_DEGREE,
      DEFAULT_FOCUS_CAP,
    );
    const elapsed = performance.now() - start;
    // eslint-disable-next-line no-console
    console.info(`expandNeighborhood(hub): ${elapsed.toFixed(0)}ms`);
    expect(hub.truncated).toBe(true);
    expect(hub.degreeUsed).toBe(1);
    expect(elapsed).toBeLessThan(50);
  });

  it("anchor layout stays inside the zoomable range (KTD-1 risk)", () => {
    const communities = detectCommunities(graph.nodes, graph.links);
    const anchors = computeCommunityAnchors(communities);
    let maxRadius = 0;
    for (const anchor of anchors.values()) {
      expect(Number.isFinite(anchor.x)).toBe(true);
      expect(Number.isFinite(anchor.y)).toBe(true);
      maxRadius = Math.max(maxRadius, Math.hypot(anchor.x, anchor.y));
    }
    // The whole spiral must sit comfortably inside the initial framing
    // distance so no cluster is pushed past the camera's usable range.
    expect(maxRadius).toBeLessThan(initialCameraZ(graph.nodes.length));
  });
});
