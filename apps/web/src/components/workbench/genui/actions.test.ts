import { describe, expect, it } from "vitest";
import { createTaskReviewGenUIFixture } from "@thinkwork/genui";
import {
  buildHandleGenUIActionInput,
  canSubmitGenUIAction,
  createGenUIActionIdempotencyKey,
} from "./actions";

describe("GenUI action helpers", () => {
  it("builds a server-verifiable action input from persisted source context", () => {
    const fixture = createTaskReviewGenUIFixture();
    const action = fixture.data.actions![0]!;
    const source = {
      threadId: "thread-1",
      sourceMessageId: "message-1",
      partId: fixture.id,
      data: fixture.data,
    };

    expect(canSubmitGenUIAction(source)).toBe(true);
    expect(buildHandleGenUIActionInput(source, action)).toEqual({
      threadId: "thread-1",
      sourceMessageId: "message-1",
      partId: fixture.id,
      actionId: action.id,
      specHash: fixture.data.specHash,
      idempotencyKey: createGenUIActionIdempotencyKey(source, action),
      params: { taskId: "task-123" },
    });
  });

  it("keeps idempotency keys bounded without truncating source entropy", () => {
    const fixture = createTaskReviewGenUIFixture();
    const action = fixture.data.actions![0]!;
    const baseSource = {
      threadId: `thread-${"a".repeat(200)}`,
      sourceMessageId: `message-${"b".repeat(200)}`,
      partId: fixture.id,
      data: fixture.data,
    };
    const otherSource = {
      ...baseSource,
      partId: `${fixture.id}-other`,
    };

    const first = createGenUIActionIdempotencyKey(baseSource, action);
    const second = createGenUIActionIdempotencyKey(otherSource, action);

    expect(first).toMatch(/^genui-action:genui-fnv1a:[a-f0-9]{8}$/);
    expect(first.length).toBeLessThan(160);
    expect(second).not.toBe(first);
  });

  it("rejects live or incomplete source context", () => {
    const fixture = createTaskReviewGenUIFixture();
    const action = fixture.data.actions![0]!;
    const source = {
      threadId: "thread-1",
      sourceMessageId: null,
      partId: fixture.id,
      data: fixture.data,
    };

    expect(canSubmitGenUIAction(source)).toBe(false);
    expect(() => buildHandleGenUIActionInput(source, action)).toThrow(
      "Generated UI action source is not ready.",
    );
  });
});
