import { describe, expect, it } from "vitest";
import { threadJsonRenderStateSnapshotPayload } from "@thinkwork/thread-json-render";

import { createTaskReviewJsonRenderFixture } from "./json-render/fixtures";
import { uiMessageChunkFromThreadTurnPayload } from "./SpacesThreadDetailRoute";

describe("uiMessageChunkFromThreadTurnPayload (thread_turn_events fold)", () => {
  it("unwraps an AG-UI STATE_SNAPSHOT envelope to the part (same merge path as legacy)", () => {
    const part = createTaskReviewJsonRenderFixture();
    const payload = threadJsonRenderStateSnapshotPayload(part);

    expect(uiMessageChunkFromThreadTurnPayload(payload)).toEqual(part);
  });

  it("still folds the legacy ui_message_chunk kind identically", () => {
    const part = createTaskReviewJsonRenderFixture();
    const legacy = {
      kind: "thread_json_render.ui_message_chunk",
      chunk: part,
    };

    expect(uiMessageChunkFromThreadTurnPayload(legacy)).toEqual(part);
  });

  it("folds a snapshot and a legacy chunk to the same part id (dual-emission converges)", () => {
    const part = createTaskReviewJsonRenderFixture();
    const fromSnapshot = uiMessageChunkFromThreadTurnPayload(
      threadJsonRenderStateSnapshotPayload(part),
    ) as { id: string };
    const fromLegacy = uiMessageChunkFromThreadTurnPayload({
      kind: "thread_json_render.ui_message_chunk",
      chunk: part,
    }) as { id: string };

    expect(fromSnapshot.id).toBe(fromLegacy.id);
  });

  it("ignores unknown future event types without breaking the fold", () => {
    expect(
      uiMessageChunkFromThreadTurnPayload({ kind: "some.future.ag_ui_event" }),
    ).toBeNull();
    expect(
      uiMessageChunkFromThreadTurnPayload({
        kind: "thread_json_render.state_delta",
        event: { type: "STATE_DELTA", partId: "x", delta: [] },
      }),
    ).toBeNull();
    expect(uiMessageChunkFromThreadTurnPayload(null)).toBeNull();
    expect(uiMessageChunkFromThreadTurnPayload("nope")).toBeNull();
  });
});

describe("document.card fold behavior (THINK-147 U6)", () => {
  it("document.card payloads are NOT folded into json-render parts", () => {
    // The card must flow through as a plain turn event (rendered by
    // actionRowForEvent), never into the strict-validated parts stream.
    expect(
      uiMessageChunkFromThreadTurnPayload({
        kind: "document.card",
        card: { artifactId: "a", title: "T" },
      }),
    ).toBeNull();
  });
});
