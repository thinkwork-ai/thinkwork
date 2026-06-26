import { describe, expect, it } from "vitest";
import {
  createTaskReviewJsonRenderFixture,
  validateThreadJsonRenderPart,
} from "@thinkwork/thread-json-render";

describe("Pi runtime json-render contract import", () => {
  it("uses the shared Thread json-render schema version", () => {
    const fixture = createTaskReviewJsonRenderFixture();

    expect(fixture.data.schemaVersion).toBe("thread-json-render/v1");
    expect(validateThreadJsonRenderPart(fixture).ok).toBe(true);
  });
});
