import { describe, expect, it } from "vitest";
import {
  THREAD_JSON_RENDER_PART_TYPE,
  createTaskReviewJsonRenderFixture,
  validateThreadJsonRenderPart,
} from "@thinkwork/thread-json-render";

describe("API json-render contract import", () => {
  it("validates the shared Thread json-render envelope", () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const result = validateThreadJsonRenderPart(fixture);

    expect(fixture.type).toBe(THREAD_JSON_RENDER_PART_TYPE);
    expect(result.ok).toBe(true);
  });
});
