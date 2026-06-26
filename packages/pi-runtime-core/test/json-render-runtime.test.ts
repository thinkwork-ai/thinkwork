import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTaskReviewJsonRenderFixture } from "@thinkwork/thread-json-render";

import {
  EMIT_JSON_RENDER_UI_TOOL_NAME,
  THREAD_JSON_RENDER_ACTIVITY_PAYLOAD_KIND,
  buildEmitJsonRenderUiTool,
  extractEmitJsonRenderToolPart,
  normalizeRuntimeThreadJsonRenderInput,
  threadJsonRenderActivityEvent,
} from "../src/json-render-runtime.js";

describe("runtime Thread json-render helper", () => {
  it("accepts the checked-in valid-card fixture as trusted runtime UI", () => {
    const fixture = readJsonFixture("valid-card.json");
    const result = normalizeRuntimeThreadJsonRenderInput(fixture);

    expect(result.ok).toBe(true);
    expect(result.part).toMatchObject({
      type: "data-json-render",
      id: "json-render:primitive:review",
      data: {
        specHash: "json-render-fnv1a:00b0bb9e",
        mobileFallback: {
          title: "Pipeline health",
          summary: "All checks are ready.",
        },
      },
    });
  });

  it("accepts a valid canonical data-json-render part", () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const result = normalizeRuntimeThreadJsonRenderInput(fixture);

    expect(result.ok).toBe(true);
    expect(result.part).toEqual(fixture);
  });

  it("wraps valid tool input with a stable fallback part id", () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const result = normalizeRuntimeThreadJsonRenderInput(
      {
        spec: fixture.data.spec,
        mobileFallback: fixture.data.mobileFallback,
        durableActions: fixture.data.durableActions,
      },
      "json-render:tool:0",
    );

    expect(result.ok).toBe(true);
    expect(result.part).toMatchObject({
      type: "data-json-render",
      id: "json-render:tool:0",
      data: {
        schemaVersion: "thread-json-render/v1",
        catalogVersion: "thread-json-render-catalog/v1",
        spec: fixture.data.spec,
        mobileFallback: fixture.data.mobileFallback,
      },
    });
    expect(result.part?.data.specHash).toBe(fixture.data.specHash);
  });

  it("rejects invalid candidates instead of producing diagnostic UI parts", () => {
    const result = normalizeRuntimeThreadJsonRenderInput(
      { nope: true },
      "json-render:bad",
    );

    expect(result.ok).toBe(false);
    expect(result.part).toBeUndefined();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("rejects legacy component JSON and markdown fences as trusted runtime UI", () => {
    const legacy = readJsonFixture("invalid-legacy-component.json");
    const fenced = readMarkdownFixture("invalid-fenced-markdown.md");

    const legacyResult = normalizeRuntimeThreadJsonRenderInput(
      legacy,
      "json-render:legacy",
    );
    const fencedResult = normalizeRuntimeThreadJsonRenderInput(
      fenced,
      "json-render:fenced",
    );

    expect(legacyResult.ok).toBe(false);
    expect(legacyResult.part).toBeUndefined();
    expect(fencedResult.ok).toBe(false);
    expect(fencedResult.part).toBeUndefined();
  });

  it("builds the live activity UIMessage chunk envelope", () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const event = threadJsonRenderActivityEvent(fixture);

    expect(event).toMatchObject({
      eventType: "ui_message_chunk",
      stream: "ui",
      payload: {
        kind: THREAD_JSON_RENDER_ACTIVITY_PAYLOAD_KIND,
        chunk: fixture,
      },
    });
  });

  it("exposes a narrow emit_json_render_ui tool", async () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const tool = buildEmitJsonRenderUiTool();

    expect(tool.name).toBe(EMIT_JSON_RENDER_UI_TOOL_NAME);

    const result = await tool.execute("call-1", {
      spec: fixture.data.spec,
      mobileFallback: fixture.data.mobileFallback,
      durableActions: fixture.data.durableActions,
    });

    const part = extractEmitJsonRenderToolPart(result);
    expect(part).toMatchObject({
      type: "data-json-render",
      id: expect.stringMatching(/^json-render:/),
      data: {
        spec: fixture.data.spec,
        mobileFallback: fixture.data.mobileFallback,
        durableActions: fixture.data.durableActions,
        specHash: fixture.data.specHash,
      },
    });
  });
});

function readJsonFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../../docs/fixtures/thread-json-render", name),
      "utf8",
    ),
  );
}

function readMarkdownFixture(name: string): string {
  return readFileSync(
    resolve(process.cwd(), "../../docs/fixtures/thread-json-render", name),
    "utf8",
  );
}
