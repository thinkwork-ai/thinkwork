/**
 * `normalizeUiMessageParts` is the server-side gate every durable UI message
 * part passes before it lands in `messages.parts` — the only place an
 * unvalidated model-authored part could reach a client. These cover the
 * `data-chart` family added in THINK-672 alongside the existing json-render
 * parts.
 */
import { createPrimitiveJsonRenderFixture } from "@thinkwork/thread-json-render";
import { describe, expect, it, vi } from "vitest";

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({}),
}));

const { normalizeUiMessageParts } = await import("./notify.js");

function chartPart(id: string, title = "Revenue by region") {
  return {
    type: "data-chart",
    id,
    data: {
      type: "bar",
      title,
      series: [
        { label: "EMEA", value: 12 },
        { label: "AMER", value: 20 },
      ],
    },
  };
}

const JSON_RENDER_PART = createPrimitiveJsonRenderFixture();

describe("normalizeUiMessageParts", () => {
  it("returns null for absent or empty input", () => {
    expect(normalizeUiMessageParts(undefined)).toBeNull();
    expect(normalizeUiMessageParts([])).toBeNull();
  });

  it("keeps a valid data-chart part", () => {
    const parts = normalizeUiMessageParts([chartPart("chart:1")]);
    expect(parts).toHaveLength(1);
    expect(parts?.[0]).toMatchObject({ type: "data-chart", id: "chart:1" });
    expect((parts?.[0] as { data: { title: string } }).data.title).toBe(
      "Revenue by region",
    );
  });

  it("drops an invalid data-chart part", () => {
    const parts = normalizeUiMessageParts([
      { type: "data-chart", id: "chart:bad", data: { type: "hologram" } },
      { type: "data-chart", id: "chart:no-series", data: { type: "bar" } },
      { type: "data-chart", data: chartPart("x").data },
    ]);
    expect(parts).toBeNull();
  });

  it("dedupes chart parts by id, last write wins", () => {
    const parts = normalizeUiMessageParts([
      chartPart("chart:1", "First"),
      chartPart("chart:1", "Second"),
    ]);
    expect(parts).toHaveLength(1);
    expect((parts?.[0] as { data: { title: string } }).data.title).toBe(
      "Second",
    );
  });

  it("keeps json-render and chart parts side by side", () => {
    const parts = normalizeUiMessageParts([
      JSON_RENDER_PART as unknown as Record<string, unknown>,
      chartPart("chart:1"),
    ]);
    expect(parts?.map((p) => p.type)).toEqual([
      "data-json-render",
      "data-chart",
    ]);
  });
});
