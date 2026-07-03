import { describe, expect, it } from "vitest";

import {
  threadJsonRenderComponentNames,
  threadJsonRenderDomainComponentNames,
  threadJsonRenderLocalActionDefinitions,
  threadJsonRenderPrimitiveComponentNames,
} from "./catalog";

describe("Thread json-render catalog", () => {
  it("enumerates the upstream shadcn primitive catalog from package APIs", () => {
    expect(
      threadJsonRenderPrimitiveComponentNames.length,
    ).toBeGreaterThanOrEqual(30);
    expect(threadJsonRenderPrimitiveComponentNames).toEqual(
      expect.arrayContaining(["Card", "Stack", "Heading", "Text", "Button"]),
    );
  });

  it("layers ThinkWork domain entries on top of primitives", () => {
    expect(threadJsonRenderDomainComponentNames).toEqual([
      "task.review",
      "workflow.status",
      "keyValue.list",
      "form.action",
      "result.list",
      "table",
      "chart",
    ]);
    expect(threadJsonRenderComponentNames).toEqual(
      expect.arrayContaining([
        "Card",
        "Button",
        "task.review",
        "result.list",
      ]),
    );
  });

  it("keeps json-render local actions separate from durable ThinkWork actions", () => {
    expect(threadJsonRenderLocalActionDefinitions).toEqual({});
  });
});
