/**
 * Gate-fires tests (THINK-147 U5): the dead-gate lesson. The access predicate
 * must match rows the REAL writer persists — never a hand-typed literal that
 * can drift from the emission code path (the `genui_snapshot` vs
 * `json_render_snapshot` regression this repo already shipped once).
 */
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_GATED_KIND,
  isCanvasArtifact,
} from "./canvas-access.js";
import { DOCUMENT_METADATA_KIND } from "./document-emission.js";

describe("document access gating (gate-fires)", () => {
  it("the gate constant matches the value the emission writer persists", () => {
    expect(DOCUMENT_GATED_KIND).toBe(DOCUMENT_METADATA_KIND);
  });

  it("a row shaped like the emission upsert writes is access-gated", () => {
    // Mirror of upsertDocumentRow's metadata shape in document-emission.ts —
    // built from the writer's exported constant, not a hand-typed string.
    const row = {
      metadata: {
        kind: DOCUMENT_METADATA_KIND,
        genre: "report",
        documentId: "doc-1",
        createdBy: null,
      },
    };
    expect(isCanvasArtifact(row)).toBe(true);
  });

  it("gates metadata stored as a JSON string too", () => {
    expect(
      isCanvasArtifact({
        metadata: JSON.stringify({ kind: DOCUMENT_METADATA_KIND }),
      }),
    ).toBe(true);
  });

  it("does not gate legacy markdown artifacts", () => {
    expect(isCanvasArtifact({ metadata: { kind: "note" } })).toBe(false);
    expect(isCanvasArtifact({ metadata: null })).toBe(false);
  });
});
