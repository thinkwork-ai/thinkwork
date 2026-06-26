import { describe, expect, it } from "vitest";

import {
  buildHandleThreadJsonRenderActionInput,
  canSubmitThreadJsonRenderAction,
  createThreadJsonRenderActionIdempotencyKey,
  normalizeThreadJsonRenderActionParams,
} from "./actions.js";
import { createTaskReviewJsonRenderFixture } from "./test-fixtures.js";

describe("thread json-render action helpers", () => {
  it("builds a server-verifiable action input from persisted source context", () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const action = fixture.data.durableActions![0]!;
    const source = {
      threadId: "thread-1",
      sourceMessageId: "message-1",
      partId: fixture.id,
      data: fixture.data,
    };

    expect(canSubmitThreadJsonRenderAction(source)).toBe(true);
    expect(buildHandleThreadJsonRenderActionInput(source, action)).toEqual({
      threadId: "thread-1",
      sourceMessageId: "message-1",
      partId: fixture.id,
      actionId: action.id,
      specHash: fixture.data.specHash,
      idempotencyKey: createThreadJsonRenderActionIdempotencyKey(
        source,
        action,
      ),
      params: {
        target: "work_item_status",
        workItemId: "77777777-7777-7777-7777-777777777777",
        statusCategory: "DONE",
        note: "Approved from generated UI",
      },
    });
  });

  it("keeps idempotency keys bounded without truncating source entropy", () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const action = fixture.data.durableActions![0]!;
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

    const first = createThreadJsonRenderActionIdempotencyKey(
      baseSource,
      action,
    );
    const second = createThreadJsonRenderActionIdempotencyKey(
      otherSource,
      action,
    );

    expect(first).toMatch(/^json-render-action:json-render-fnv1a:[a-f0-9]{8}$/);
    expect(first.length).toBeLessThan(160);
    expect(second).not.toBe(first);
  });

  it("rejects live or incomplete source context", () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const action = fixture.data.durableActions![0]!;
    const source = {
      threadId: "thread-1",
      sourceMessageId: null,
      partId: fixture.id,
      data: fixture.data,
    };

    expect(canSubmitThreadJsonRenderAction(source)).toBe(false);
    expect(() =>
      buildHandleThreadJsonRenderActionInput(source, action),
    ).toThrow("Generated UI action source is not ready.");
  });

  it("normalizes only primitive durable action params", () => {
    expect(
      normalizeThreadJsonRenderActionParams({
        ok: true,
        count: 2,
        label: "Approve",
        none: null,
        nested: { bad: true } as never,
      }),
    ).toEqual({ ok: true, count: 2, label: "Approve", none: null });
  });
});
