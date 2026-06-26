import { describe, expect, it } from "vitest"

import {
  THREAD_JSON_RENDER_ACTIVITY_PAYLOAD_KIND,
  THREAD_JSON_RENDER_CATALOG_VERSION,
  THREAD_JSON_RENDER_PART_TYPE,
  THREAD_JSON_RENDER_SCHEMA_VERSION,
  createThreadJsonRenderSpecHash,
  normalizeRuntimeThreadJsonRenderPart,
  threadJsonRenderActivityEvent,
  validateThreadJsonRenderPart,
} from "../src/json-render-runtime.js"

const allowedComponents = ["Card", "Stack", "Heading", "Text", "Button"]

describe("runtime Thread json-render helper", () => {
  it("accepts a valid data-json-render part", () => {
    const part = createPart()
    const result = normalizeRuntimeThreadJsonRenderPart(part, undefined, {
      allowedComponents,
    })

    expect(result.ok).toBe(true)
    expect(result.part).toEqual(part)
    expect(validateThreadJsonRenderPart(part, { allowedComponents }).ok).toBe(
      true,
    )
  })

  it("wraps valid data with a stable fallback part id", () => {
    const part = createPart()
    const result = normalizeRuntimeThreadJsonRenderPart(
      part.data,
      "json-render:tool:0",
      { allowedComponents },
    )

    expect(result.ok).toBe(true)
    expect(result.part).toMatchObject({
      type: "data-json-render",
      id: "json-render:tool:0",
      data: part.data,
    })
  })

  it("turns invalid candidates into diagnostic data-json-render parts", () => {
    const result = normalizeRuntimeThreadJsonRenderPart(
      { nope: true },
      "json-render:bad",
      { allowedComponents },
    )

    expect(result.ok).toBe(false)
    expect(result.part).toMatchObject({
      type: "data-json-render",
      id: "json-render:bad",
      data: {
        status: "invalid",
        mobileFallback: {
          title: "Generated UI unavailable",
        },
      },
    })
    expect(result.part.data.diagnostics?.[0]?.severity).toBe("error")
  })

  it("builds the live activity UIMessage chunk envelope", () => {
    const part = createPart()
    const event = threadJsonRenderActivityEvent(part)

    expect(event).toMatchObject({
      eventType: "ui_message_chunk",
      stream: "ui",
      payload: {
        kind: THREAD_JSON_RENDER_ACTIVITY_PAYLOAD_KIND,
        chunk: part,
      },
    })
  })
})

function createPart() {
  const spec = {
    root: "card",
    elements: {
      card: {
        type: "Card",
        props: {
          title: "Pipeline health",
          description: "On track",
          maxWidth: null,
          centered: false,
          className: null,
        },
        children: ["heading"],
      },
      heading: {
        type: "Heading",
        props: { text: "Pipeline health", level: "h3" },
        children: [],
      },
    },
  }

  return {
    type: THREAD_JSON_RENDER_PART_TYPE,
    id: "json-render:primitive:review",
    data: {
      schemaVersion: THREAD_JSON_RENDER_SCHEMA_VERSION,
      catalogVersion: THREAD_JSON_RENDER_CATALOG_VERSION,
      status: "ready",
      spec,
      mobileFallback: {
        title: "Pipeline health",
        summary: "On track",
      },
      specHash: createThreadJsonRenderSpecHash(spec),
    },
  } as const
}
