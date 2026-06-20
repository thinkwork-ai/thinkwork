import { describe, expect, it } from "vitest";

import { createThreadGenUIAdapterRegistry } from "./adapter-registry.js";
import { genUIError } from "./diagnostics.js";
import { createThreadGenUISpecHash } from "./hash.js";
import { threadGenUILimits } from "./limits.js";
import {
  THREAD_GENUI_CATALOG_VERSION,
  THREAD_GENUI_PART_TYPE,
  THREAD_GENUI_SCHEMA_VERSION,
  type ThreadGenUIPart,
  type ThreadGenUISpec,
} from "./spec.js";
import { createTaskReviewGenUIFixture } from "./test-fixtures.js";
import {
  createThreadGenUIDiagnosticData,
  validateThreadGenUIData,
  validateThreadGenUIPart,
} from "./validation.js";

describe("validateThreadGenUIPart", () => {
  it("accepts a valid task review spec and preserves its stable id", () => {
    const fixture = createTaskReviewGenUIFixture();
    const result = validateThreadGenUIPart(fixture);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.part.id).toBe("genui:task-review:123");
      expect(result.part.data.spec.elements.review.component).toBe(
        "task.review",
      );
    }
  });

  it("rejects unknown components with a sanitized diagnostic", () => {
    const fixture = createTaskReviewGenUIFixture();
    fixture.data.spec.elements.review.component = "UnapprovedChart3D";

    const result = validateThreadGenUIPart(fixture);

    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("GENUI_COMPONENT_UNSUPPORTED");
    if (result.ok) throw new Error("Expected validation to fail.");
    const diagnosticData = createThreadGenUIDiagnosticData(
      result.diagnostics[0]!,
    );
    expect(diagnosticData.status).toBe("invalid");
    expect(diagnosticData.mobileFallback.title).toBe(
      "Unsupported generated UI",
    );
  });

  it("rejects unknown action references and invalid action params", () => {
    const fixture = createTaskReviewGenUIFixture();
    fixture.data.spec.elements.review.props.primaryActionId = "missing-action";
    fixture.data.actions = [
      {
        id: "approve-task",
        label: "Approve",
        kind: "launch-missiles" as never,
        params: { nested: { bad: true } } as never,
      },
    ];

    const result = validateThreadGenUIPart(fixture);

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "GENUI_ACTION_KIND_INVALID",
        "GENUI_ACTION_PARAM_INVALID",
        "GENUI_ACTION_REFERENCE_INVALID",
      ]),
    );
  });

  it("fails closed for analytical payloads before U8 registers the adapter", () => {
    const fixture = createTaskReviewGenUIFixture();
    fixture.data.spec.elements.review.component = "analytics.display";
    fixture.data.spec.elements.review.props = {
      analyticsDisplayVersion: "analytics-display/v1",
    };

    const result = validateThreadGenUIPart(fixture);

    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("GENUI_ANALYTICS_ADAPTER_MISSING");
    expect(JSON.stringify(result)).toContain("packages/analytics-display");
  });

  it("allows reserved adapter components only when an adapter is registered", () => {
    const fixture = createTaskReviewGenUIFixture();
    fixture.data.spec.elements.review.component = "analytics.display";
    fixture.data.spec.elements.review.props = {
      analyticsDisplayVersion: "analytics-display/v1",
    };
    fixture.data.specHash = createThreadGenUISpecHash(fixture.data.spec);
    const registry = createThreadGenUIAdapterRegistry([
      {
        component: "analytics.display",
        validateElement: () => [],
      },
    ]);

    const result = validateThreadGenUIPart(
      fixture,
      registry.toValidationContext(),
    );

    expect(result.ok).toBe(true);
  });

  it("propagates registered adapter diagnostics", () => {
    const fixture = createTaskReviewGenUIFixture();
    fixture.data.spec.elements.review.component = "analytics.display";
    fixture.data.spec.elements.review.props = {
      analyticsDisplayVersion: "analytics-display/v1",
    };
    fixture.data.specHash = createThreadGenUISpecHash(fixture.data.spec);
    const registry = createThreadGenUIAdapterRegistry([
      {
        component: "analytics.display",
        validateElement: () => [
          genUIError(
            "GENUI_ADAPTER_PAYLOAD_INVALID",
            "Adapter payload is invalid.",
            "$.data.spec.elements.review",
          ),
        ],
      },
    ]);

    const result = validateThreadGenUIPart(
      fixture,
      registry.toValidationContext(),
    );

    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("GENUI_ADAPTER_PAYLOAD_INVALID");
  });

  it("accepts each v1 native workflow component shape", () => {
    const specs: ThreadGenUISpec[] = [
      {
        root: "workflow",
        elements: {
          workflow: {
            component: "workflow.status",
            props: {
              title: "Onboarding",
              status: "running",
              steps: [{ id: "step-1", title: "Kickoff", status: "completed" }],
            },
          },
        },
      },
      {
        root: "details",
        elements: {
          details: {
            component: "keyValue.list",
            props: {
              title: "Summary",
              items: [{ label: "Owner", value: "Jane" }],
            },
          },
        },
      },
      {
        root: "form",
        elements: {
          form: {
            component: "form.action",
            props: {
              title: "Approve task",
              fields: [
                {
                  id: "note",
                  label: "Note",
                  type: "textarea",
                  required: false,
                },
              ],
              submitActionId: "submit-form",
            },
          },
        },
      },
    ];

    for (const spec of specs) {
      expect(validateThreadGenUIPart(partFromSpec(spec)).ok).toBe(true);
    }
  });

  it("rejects malformed native workflow component collections", () => {
    const invalidSpecs: ThreadGenUISpec[] = [
      {
        root: "workflow",
        elements: {
          workflow: {
            component: "workflow.status",
            props: {
              title: "Onboarding",
              status: "running",
              steps: [
                { id: "step-1", title: "Kickoff", status: "teleporting" },
              ],
            },
          },
        },
      },
      {
        root: "details",
        elements: {
          details: {
            component: "keyValue.list",
            props: {
              items: [{ label: "Nested", value: { bad: true } }],
            },
          },
        },
      },
      {
        root: "form",
        elements: {
          form: {
            component: "form.action",
            props: {
              title: "Approve task",
              fields: [
                {
                  id: "choice",
                  label: "Choice",
                  type: "select",
                  options: ["A", { bad: true }],
                },
              ],
            },
          },
        },
      },
    ];

    const diagnostics = invalidSpecs.flatMap((spec) =>
      codes(validateThreadGenUIPart(partFromSpec(spec))),
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        "GENUI_ENUM_INVALID",
        "GENUI_PRIMITIVE_REQUIRED",
        "GENUI_ARRAY_ITEM_INVALID",
      ]),
    );
  });

  it("rejects unknown native component props", () => {
    const fixture = createTaskReviewGenUIFixture();
    fixture.data.spec.elements.review.props.renderer = "custom-react";

    const result = validateThreadGenUIPart(fixture);

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining(["GENUI_FORBIDDEN_FIELD", "GENUI_UNKNOWN_KEY"]),
    );
  });

  it("rejects missing envelope fields and oversized payloads", () => {
    const result = validateThreadGenUIData({
      schemaVersion: "thread-genui/v1",
      catalogVersion: "thread-genui-catalog/v1",
      status: "ready",
      spec: {
        root: "review",
        elements: {
          review: {
            component: "task.review",
            props: {
              title: "x".repeat(threadGenUILimits.maxSerializedPartBytes),
              summary: "Summary",
              status: "pending",
            },
          },
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "GENUI_MOBILE_FALLBACK_REQUIRED",
        "GENUI_PAYLOAD_TOO_LARGE",
      ]),
    );
  });

  it("rejects remote URLs and browser callback fields before render", () => {
    const fixture = createTaskReviewGenUIFixture();
    fixture.data.spec.elements.review.props = {
      ...fixture.data.spec.elements.review.props,
      href: "https://example.com/bad",
      onClick: "doSomething",
    };

    const result = validateThreadGenUIPart(fixture);

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "GENUI_FORBIDDEN_FIELD",
        "GENUI_REMOTE_MEDIA_FORBIDDEN",
      ]),
    );
  });
});

function partFromSpec(spec: ThreadGenUISpec): ThreadGenUIPart {
  return {
    type: THREAD_GENUI_PART_TYPE,
    id: `genui:test:${spec.root}`,
    data: {
      schemaVersion: THREAD_GENUI_SCHEMA_VERSION,
      catalogVersion: THREAD_GENUI_CATALOG_VERSION,
      spec,
      status: "ready",
      actions: [{ id: "submit-form", label: "Submit", kind: "submit" }],
      mobileFallback: {
        title: "Generated UI",
        summary: "Fallback summary",
      },
      specHash: createThreadGenUISpecHash(spec),
    },
  };
}

function codes(
  result:
    | ReturnType<typeof validateThreadGenUIPart>
    | ReturnType<typeof validateThreadGenUIData>,
) {
  return result.ok
    ? []
    : result.diagnostics.map((diagnostic) => diagnostic.code);
}
