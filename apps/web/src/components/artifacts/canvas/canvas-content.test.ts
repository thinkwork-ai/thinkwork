import { describe, expect, it } from "vitest";
import {
  isLivingCanvasMetadata,
  parseLivingCanvasPart,
} from "./canvas-content";

describe("parseLivingCanvasPart", () => {
  it("extracts { id, data } from a stringified json-render part", () => {
    const content = JSON.stringify({
      type: "data-json-render",
      id: "part-abc",
      data: { spec: { root: "r", elements: {} } },
    });
    expect(parseLivingCanvasPart(content)).toEqual({
      id: "part-abc",
      data: { spec: { root: "r", elements: {} } },
    });
  });

  it("returns null for the legacy promote snapshot envelope and junk", () => {
    expect(
      parseLivingCanvasPart(
        JSON.stringify({ kind: "json_render_snapshot", source: {} }),
      ),
    ).toBeNull();
    expect(parseLivingCanvasPart("not json")).toBeNull();
    expect(parseLivingCanvasPart(null)).toBeNull();
    expect(parseLivingCanvasPart("[]")).toBeNull();
  });
});

describe("isLivingCanvasMetadata", () => {
  it("matches only the living canvas kind (object or json string)", () => {
    expect(isLivingCanvasMetadata({ kind: "json_render_canvas" })).toBe(true);
    expect(isLivingCanvasMetadata('{"kind":"json_render_canvas"}')).toBe(true);
    expect(isLivingCanvasMetadata({ kind: "json_render_snapshot" })).toBe(
      false,
    );
    expect(isLivingCanvasMetadata(null)).toBe(false);
  });
});
