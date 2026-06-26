import { describe, expect, it } from "vitest"

import {
  THREAD_JSON_RENDER_CATALOG_VERSION,
  THREAD_JSON_RENDER_PART_TYPE,
  THREAD_JSON_RENDER_SCHEMA_VERSION,
  validateThreadJsonRenderPart,
} from "./validation.js"
import { createThreadJsonRenderSpecHash } from "./hash.js"

describe("API Thread json-render validation boundary", () => {
  it("validates the shared data-json-render carrier", () => {
    const spec = {
      root: "message",
      elements: {
        message: {
          type: "Text",
          props: { text: "Ready", variant: "body" },
          children: [],
        },
      },
    }
    const result = validateThreadJsonRenderPart(
      {
        type: THREAD_JSON_RENDER_PART_TYPE,
        id: "json-render:text:ready",
        data: {
          schemaVersion: THREAD_JSON_RENDER_SCHEMA_VERSION,
          catalogVersion: THREAD_JSON_RENDER_CATALOG_VERSION,
          status: "ready",
          spec,
          mobileFallback: { title: "Ready", summary: "Ready" },
          specHash: createThreadJsonRenderSpecHash(spec),
        },
      },
      { allowedComponents: ["Text"] },
    )

    expect(result.ok).toBe(true)
  })

  it("rejects old data-genui at the API boundary", () => {
    const result = validateThreadJsonRenderPart({
      type: "data-genui",
      id: "legacy",
      data: {},
    })

    expect(result.ok).toBe(false)
    expect(
      result.ok ? [] : result.diagnostics.map((item) => item.code),
    ).toContain("JSON_RENDER_PART_TYPE_INVALID")
  })
})
