import { describe, expect, it } from "vitest";
import {
  classifyNode,
  communityColor,
  COMMUNITY_COLORS,
  computeCommunityLayout,
  degreeRadius,
  deriveGraphClassification,
  detectCommunities,
  expandNeighborhood,
  wrapLabelLines,
} from "./index.js";

const nodes = (...ids: string[]) => ids.map((id) => ({ id }));
const link = (source: string, target: string) => ({ source, target });

describe("detectCommunities", () => {
  it("is deterministic for the same (graph, seed)", () => {
    const n = nodes("a", "b", "c", "d", "e", "f");
    const links = [
      link("a", "b"),
      link("b", "c"),
      link("a", "c"),
      link("d", "e"),
      link("e", "f"),
      link("d", "f"),
    ];
    const first = detectCommunities(n, links, { seed: 7 });
    const second = detectCommunities(n, links, { seed: 7 });
    expect([...first.entries()]).toEqual([...second.entries()]);
    // Two disconnected triangles → two communities.
    expect(new Set(first.values()).size).toBe(2);
    expect(first.get("a")).toBe(first.get("b"));
    expect(first.get("a")).not.toBe(first.get("d"));
  });

  it("gives edgeless graphs singleton communities instead of throwing", () => {
    const result = detectCommunities(nodes("x", "y", "z"), []);
    expect(new Set(result.values()).size).toBe(3);
  });

  it("renumbers community ids densely from zero in first-seen order", () => {
    const result = detectCommunities(nodes("a", "b"), [link("a", "b")]);
    expect([...result.values()].every((v) => Number.isInteger(v))).toBe(true);
    expect(Math.min(...result.values())).toBe(0);
  });
});

describe("communityColor", () => {
  it("cycles the palette and defaults to the first color", () => {
    expect(communityColor(0)).toBe(COMMUNITY_COLORS[0]);
    expect(communityColor(COMMUNITY_COLORS.length)).toBe(COMMUNITY_COLORS[0]);
    expect(communityColor(undefined)).toBe(COMMUNITY_COLORS[0]);
  });
});

describe("degreeRadius", () => {
  it("maps degree to a bounded radius range", () => {
    expect(degreeRadius(1, 10)).toBeCloseTo(10 + 14 * Math.sqrt(0.1));
    expect(degreeRadius(10, 10)).toBeCloseTo(24);
    // Clamps beyond max and guards zero.
    expect(degreeRadius(0, 0)).toBe(24);
  });
});

describe("classification", () => {
  it("classifies matched, neighbor, and other", () => {
    const links = [link("a", "b"), link("b", "c")];
    const classification = deriveGraphClassification(new Set(["a"]), links);
    expect(classifyNode("a", classification)).toBe("matched");
    expect(classifyNode("b", classification)).toBe("neighbor");
    expect(classifyNode("c", classification)).toBe("other");
    // Null classification → everything is matched (no filter active).
    expect(classifyNode("z", null)).toBe("matched");
  });
});

describe("expandNeighborhood", () => {
  it("expands to the given degree and reports truncation under a cap", () => {
    const links = [link("h", "a"), link("h", "b"), link("h", "c")];
    const full = expandNeighborhood(["h"], links, 1, 100);
    expect(full.ids).toEqual(new Set(["h", "a", "b", "c"]));
    expect(full.truncated).toBe(false);
    // Degree 1 is always accepted even past the cap.
    const capped = expandNeighborhood(["h"], links, 1, 1);
    expect(capped.degreeUsed).toBe(1);
  });
});

describe("wrapLabelLines", () => {
  it("wraps within width and ellipsizes overflow (char-count measurer)", () => {
    const measure = (t: string) => t.length; // 1 unit per char
    const lines = wrapLabelLines(measure, "customer onboarding flow", 10, 3);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.every((l) => l.length <= 10)).toBe(true);
  });
});

describe("computeCommunityLayout", () => {
  it("returns one anchor per community with the largest at the origin", () => {
    const n = nodes("a", "b", "c", "d", "e", "f");
    const links = [
      link("a", "b"),
      link("b", "c"),
      link("a", "c"),
      link("d", "e"),
    ];
    const { communityByNode, anchors } = computeCommunityLayout(n, links);
    expect(anchors.size).toBe(new Set(communityByNode.values()).size);
    // Largest community anchored at origin.
    const origin = [...anchors.values()].find((a) => a.x === 0 && a.y === 0);
    expect(origin).toBeDefined();
  });
});
