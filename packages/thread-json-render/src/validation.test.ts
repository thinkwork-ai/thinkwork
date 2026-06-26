import { describe, expect, it } from "vitest";

import { createThreadJsonRenderSpecHash } from "./hash.js";
import {
  THREAD_JSON_RENDER_CATALOG_VERSION,
  THREAD_JSON_RENDER_PART_TYPE,
  THREAD_JSON_RENDER_SCHEMA_VERSION,
  type ThreadJsonRenderPart,
  type ThreadJsonRenderSpec,
} from "./spec.js";
import {
  createAnalyticsJsonRenderFixture,
  createPrimitiveJsonRenderFixture,
  createTaskReviewJsonRenderFixture,
  createThreadJsonRenderPart,
} from "./test-fixtures.js";
import {
  sanitizeDiagnosticMessage,
  validateThreadJsonRenderData,
  validateThreadJsonRenderPart,
  validateThreadJsonRenderSpec,
} from "./validation.js";

describe("thread json-render validation", () => {
  it("accepts upstream-shaped primitive json-render specs", () => {
    const result = validateThreadJsonRenderPart(
      createPrimitiveJsonRenderFixture(),
    );

    expect(result.ok).toBe(true);
  });

  it("accepts ThinkWork domain catalog components", () => {
    const taskReview = createTaskReviewJsonRenderFixture();
    expect(validateThreadJsonRenderPart(taskReview).ok).toBe(true);
    expect(taskReview.data.durableActions?.[0]?.params).toMatchObject({
      target: "work_item_status",
      workItemId: "77777777-7777-7777-7777-777777777777",
      statusCategory: "DONE",
    });
    expect(
      validateThreadJsonRenderPart(createAnalyticsJsonRenderFixture()).ok,
    ).toBe(true);
  });

  it("allows explicit null className values but rejects generated styling", () => {
    const base = createPrimitiveJsonRenderFixture();
    expect(validateThreadJsonRenderPart(base).ok).toBe(true);

    const styled = clonePart(base);
    styled.data.spec.elements.card.props.className = "rounded-3xl";

    const result = validateThreadJsonRenderPart(styled);

    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("JSON_RENDER_FORBIDDEN_PROP");
  });

  it("rejects unknown components and invalid primitive props", () => {
    const unknownComponent = createThreadJsonRenderPart(
      "json-render:unknown",
      {
        root: "root",
        elements: {
          root: { type: "TotallyCustom", props: {}, children: [] },
        },
      },
      { title: "Unknown", summary: "Unknown" },
    );

    const invalidProps = createPrimitiveJsonRenderFixture();
    invalidProps.data.spec.elements.approve.props.variant = "laser";

    expect(codes(validateThreadJsonRenderPart(unknownComponent))).toEqual(
      expect.arrayContaining([
        "JSON_RENDER_SPEC_INVALID",
        "JSON_RENDER_COMPONENT_UNSUPPORTED",
      ]),
    );
    expect(codes(validateThreadJsonRenderPart(invalidProps))).toContain(
      "JSON_RENDER_PROPS_INVALID",
    );
  });

  it("rejects legacy data-genui and self-rolled component/props envelopes", () => {
    const legacyPart = {
      type: "data-genui",
      id: "genui:old",
      data: { component: "TaskReview", props: { title: "Old" } },
    };
    const legacySpec = createThreadJsonRenderPart(
      "json-render:legacy-spec",
      {
        root: "root",
        elements: {
          root: {
            type: "Card",
            component: "TaskReview",
            props: {
              title: "Old",
              description: "Old",
              maxWidth: null,
              centered: false,
            },
            children: [],
          } as ThreadJsonRenderSpec["elements"][string],
        },
      },
      { title: "Old", summary: "Old" },
    );

    expect(codes(validateThreadJsonRenderPart(legacyPart))).toContain(
      "JSON_RENDER_PART_TYPE_INVALID",
    );
    expect(codes(validateThreadJsonRenderPart(legacySpec))).toContain(
      "JSON_RENDER_UNKNOWN_KEY",
    );
  });

  it("rejects fenced markdown and _type payloads instead of parsing them", () => {
    expect(codes(validateThreadJsonRenderPart("```genui\n{}\n```"))).toContain(
      "JSON_RENDER_PART_NOT_OBJECT",
    );

    expect(
      codes(
        validateThreadJsonRenderPart({
          _type: "TaskReview",
          props: { title: "Review" },
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        "JSON_RENDER_UNKNOWN_KEY",
        "JSON_RENDER_PART_TYPE_INVALID",
      ]),
    );
  });

  it("rejects malformed envelopes, mismatched hashes, and oversized specs", () => {
    const part = createPrimitiveJsonRenderFixture();
    const malformed = {
      ...part,
      unexpected: true,
      data: { ...part.data, specHash: "json-render-fnv1a:deadbeef" },
    };

    expect(codes(validateThreadJsonRenderPart(malformed))).toEqual(
      expect.arrayContaining([
        "JSON_RENDER_UNKNOWN_KEY",
        "JSON_RENDER_SPEC_HASH_MISMATCH",
      ]),
    );

    const manyElements: ThreadJsonRenderSpec = {
      root: "root",
      elements: Object.fromEntries(
        Array.from({ length: 3 }, (_, index) => [
          index === 0 ? "root" : `child-${index}`,
          { type: "Text", props: { text: String(index) }, children: [] },
        ]),
      ),
    };

    expect(
      codes(
        validateThreadJsonRenderData(
          {
            schemaVersion: THREAD_JSON_RENDER_SCHEMA_VERSION,
            catalogVersion: THREAD_JSON_RENDER_CATALOG_VERSION,
            status: "ready",
            spec: manyElements,
            mobileFallback: { title: "Many", summary: "Many" },
          },
          { maxElementCount: 2 },
        ),
      ),
    ).toContain("JSON_RENDER_ELEMENT_COUNT_LIMIT");
  });

  it("rejects child cycles and missing roots", () => {
    const cyclic = createThreadJsonRenderPart(
      "json-render:cycle",
      {
        root: "a",
        elements: {
          a: { type: "Text", props: { text: "A" }, children: ["b"] },
          b: { type: "Text", props: { text: "B" }, children: ["a"] },
        },
      },
      { title: "Cycle", summary: "Cycle" },
    );
    const missingRoot = createThreadJsonRenderPart(
      "json-render:missing-root",
      {
        root: "missing",
        elements: {
          a: { type: "Text", props: { text: "A" }, children: [] },
        },
      },
      { title: "Missing", summary: "Missing" },
    );

    expect(codes(validateThreadJsonRenderPart(cyclic))).toContain(
      "JSON_RENDER_CHILD_CYCLE",
    );
    expect(codes(validateThreadJsonRenderPart(missingRoot))).toContain(
      "JSON_RENDER_SPEC_ROOT_MISSING",
    );
  });

  it("validates durable action boundaries and sanitizes diagnostics", () => {
    const part = createTaskReviewJsonRenderFixture();
    part.data.durableActions = [
      {
        id: "approve-task",
        label: "Approve",
        kind: "approve",
        params: { token: { nested: true } } as never,
      },
    ];
    part.data.diagnostics = [
      {
        code: "MODEL_ERROR",
        message: "token=abcdabcdabcdabcd secret leaked",
        severity: "error",
      },
    ];

    const result = validateThreadJsonRenderPart(part);

    expect(codes(result)).toContain("JSON_RENDER_ACTION_PARAM_NON_PRIMITIVE");
    expect(
      sanitizeDiagnosticMessage("token=abcdabcdabcdabcd secret leaked"),
    ).not.toContain("abcdabcd");
  });

  it("validates specs without requiring callers to build a full part", () => {
    const spec = createPrimitiveJsonRenderFixture().data.spec;

    expect(validateThreadJsonRenderSpec(spec).ok).toBe(true);
    expect(createThreadJsonRenderSpecHash(spec)).toMatch(
      /^json-render-fnv1a:[a-f0-9]{8}$/,
    );
  });
});

function codes(
  result:
    | ReturnType<typeof validateThreadJsonRenderData>
    | ReturnType<typeof validateThreadJsonRenderPart>,
): string[] {
  return result.ok
    ? []
    : result.diagnostics.map((diagnostic) => diagnostic.code);
}

function clonePart(part: ThreadJsonRenderPart): ThreadJsonRenderPart {
  return JSON.parse(JSON.stringify(part)) as ThreadJsonRenderPart;
}
