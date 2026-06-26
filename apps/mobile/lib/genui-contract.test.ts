import { describe, expect, it } from "vitest";

import { parseThreadJsonRenderFallbacks } from "./genui-registry";

describe("mobile json-render fallback contract", () => {
  it("can read required fallback fields from Thread data-json-render parts", () => {
    const [fallback] = parseThreadJsonRenderFallbacks([
      {
        type: "data-json-render",
        id: "json-render:task-review:123",
        data: {
          schemaVersion: "thread-json-render/v1",
          catalogVersion: "thread-json-render-catalog/v1",
          status: "ready",
          spec: {
            root: "review",
            elements: {
              review: {
                type: "task.review",
                props: {
                  title: "Review onboarding task",
                  summary: "Confirm the customer kickoff task is ready.",
                  status: "pending",
                },
                children: [],
              },
            },
          },
          mobileFallback: {
            title: "Review onboarding task",
            summary: "Confirm the customer kickoff task is ready.",
            lines: ["Status: pending"],
          },
        },
      },
    ]);

    expect(fallback).toEqual(
      expect.objectContaining({
        id: "json-render:task-review:123",
        title: "Review onboarding task",
        summary: expect.stringContaining("kickoff task"),
        component: "task.review",
        status: "ready",
      }),
    );
  });
});
