import { describe, expect, it } from "vitest";
import {
  createTaskReviewJsonRenderFixture,
  validateThreadJsonRenderPart,
} from "@thinkwork/thread-json-render";

describe("AgentCore Pi json-render contract import", () => {
  it("uses the shared Thread json-render catalog version", () => {
    const fixture = createTaskReviewJsonRenderFixture();

    expect(fixture.data.catalogVersion).toBe("thread-json-render-catalog/v1");
    expect(validateThreadJsonRenderPart(fixture).ok).toBe(true);
  });
});
