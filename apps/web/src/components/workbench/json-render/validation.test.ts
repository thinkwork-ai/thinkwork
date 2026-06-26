import { describe, expect, it } from "vitest"

import {
  createAnalyticsJsonRenderFixture,
  createPrimitiveJsonRenderFixture,
  createTaskReviewJsonRenderFixture,
} from "./fixtures"
import {
  validateThreadJsonRenderData,
  validateThreadJsonRenderPart,
  validateThreadJsonRenderSpec,
} from "./validation"

describe("Thread json-render web validation", () => {
  it("accepts a nested upstream shadcn primitive spec", () => {
    const fixture = createPrimitiveJsonRenderFixture()

    expect(validateThreadJsonRenderPart(fixture).ok).toBe(true)
    expect(validateThreadJsonRenderSpec(fixture.data.spec).ok).toBe(true)
  })

  it("accepts ThinkWork domain entries as json-render component types", () => {
    const fixture = createTaskReviewJsonRenderFixture()

    expect(validateThreadJsonRenderPart(fixture).ok).toBe(true)
    expect(fixture.data.spec.elements.review.type).toBe("task.review")
    expect(fixture.data.durableActions?.[0]?.kind).toBe("approve")
  })

  it("accepts the analytics.display adapter boundary", () => {
    const fixture = createAnalyticsJsonRenderFixture()

    expect(validateThreadJsonRenderPart(fixture).ok).toBe(true)
  })

  it("rejects unknown components before render", () => {
    const result = validateThreadJsonRenderSpec({
      root: "chart",
      elements: {
        chart: {
          type: "UnapprovedChart3D",
          props: { title: "Nope" },
          children: [],
        },
      },
    })

    expect(result.ok).toBe(false)
    expect(
      result.ok ? [] : result.diagnostics.map((item) => item.code),
    ).toContain("JSON_RENDER_SPEC_INVALID")
  })

  it("rejects invalid primitive props", () => {
    const fixture = createPrimitiveJsonRenderFixture()
    fixture.data.spec.elements.approve.props.variant = "tertiary"
    fixture.data.specHash = undefined

    const result = validateThreadJsonRenderData(fixture.data)

    expect(result.ok).toBe(false)
    expect(String(result.ok ? "" : result.diagnostics[0]?.message)).toContain(
      "variant",
    )
  })

  it("rejects unrestricted className values", () => {
    const fixture = createPrimitiveJsonRenderFixture()
    fixture.data.spec.elements.card.props.className = "fixed inset-0"
    fixture.data.specHash = undefined

    const result = validateThreadJsonRenderData(fixture.data)

    expect(result.ok).toBe(false)
    expect(
      result.ok ? [] : result.diagnostics.map((item) => item.code),
    ).toContain("JSON_RENDER_FORBIDDEN_CLASSNAME")
  })

  it("does not accept the old data-genui envelope", () => {
    const result = validateThreadJsonRenderPart({
      type: "data-genui",
      id: "legacy",
      data: {
        schemaVersion: "thread-genui/v1",
        catalogVersion: "thread-genui-catalog/v1",
        status: "ready",
        spec: { root: "review", elements: {} },
        mobileFallback: { title: "Legacy", summary: "Legacy" },
      },
    })

    expect(result.ok).toBe(false)
    expect(
      result.ok ? [] : result.diagnostics.map((item) => item.code),
    ).toContain("JSON_RENDER_PART_TYPE_INVALID")
  })
})
