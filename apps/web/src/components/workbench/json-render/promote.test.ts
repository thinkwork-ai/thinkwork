import { describe, expect, it } from "vitest";
import { createTaskReviewJsonRenderFixture } from "./fixtures";
import {
  buildPromoteJsonRenderArtifactInput,
  canPromoteJsonRender,
  createJsonRenderPromotionIdempotencyKey,
} from "./promote";

describe("json-render promotion helpers", () => {
  it("builds a server-verifiable promotion input from persisted source context", () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const source = {
      threadId: "thread-1",
      sourceMessageId: "message-1",
      partId: fixture.id,
      data: fixture.data,
    };

    expect(canPromoteJsonRender(source)).toBe(true);
    expect(buildPromoteJsonRenderArtifactInput(source)).toEqual({
      threadId: "thread-1",
      sourceMessageId: "message-1",
      partId: fixture.id,
      specHash: fixture.data.specHash,
      idempotencyKey: createJsonRenderPromotionIdempotencyKey(source),
    });
  });

  it("rejects incomplete source context", () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const source = {
      threadId: "thread-1",
      sourceMessageId: null,
      partId: fixture.id,
      data: fixture.data,
    };

    expect(canPromoteJsonRender(source)).toBe(false);
    expect(() => buildPromoteJsonRenderArtifactInput(source)).toThrow(
      "Generated UI promotion source is not ready.",
    );
  });
});
