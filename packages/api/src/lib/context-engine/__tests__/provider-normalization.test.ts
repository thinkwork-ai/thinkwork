import { describe, expect, it } from "vitest";
import { rankAndDedupe } from "../router.js";

describe("Context Engine provider normalization", () => {
  it("orders hits by score, provider family tie-break, and title", () => {
    const hits = rankAndDedupe([
      {
        id: "brain-1",
        providerId: "brain",
        family: "brain",
        title: "Brain",
        snippet: "brain",
        score: 0.5,
        scope: "auto",
        provenance: {},
      },
      {
        id: "wiki-1",
        providerId: "wiki",
        family: "wiki",
        title: "Beta",
        snippet: "b",
        score: 0.5,
        scope: "auto",
        provenance: {},
      },
      {
        id: "memory-1",
        providerId: "memory",
        family: "memory",
        title: "Alpha",
        snippet: "a",
        score: 0.5,
        scope: "auto",
        provenance: {},
      },
      {
        id: "kb-1",
        providerId: "kb",
        family: "knowledge-base",
        title: "Gamma",
        snippet: "g",
        score: 0.9,
        scope: "auto",
        provenance: {},
      },
    ]);

    expect(hits.map((hit) => hit.id)).toEqual([
      "kb-1",
      "memory-1",
      "brain-1",
      "wiki-1",
    ]);
    expect(hits.map((hit) => hit.rank)).toEqual([1, 2, 3, 4]);
  });
});
