import { describe, expect, it } from "vitest";

import { createTaskReviewJsonRenderFixture } from "../test-fixtures.js";
import {
  AGUI_EVENT_STATE_DELTA,
  AGUI_EVENT_STATE_SNAPSHOT,
  AGUI_VOCABULARY_SNAPSHOT_DATE,
  THREAD_JSON_RENDER_STATE_SNAPSHOT_PAYLOAD_KIND,
  partFromThreadJsonRenderStateSnapshotPayload,
  stateSnapshotToThreadJsonRenderPart,
  threadJsonRenderPartToStateSnapshot,
  threadJsonRenderStateSnapshotPayload,
  type ThreadJsonRenderStateDeltaEvent,
} from "./vocabulary.js";

describe("AG-UI vocabulary", () => {
  it("pins the event names and a dated snapshot", () => {
    expect(AGUI_EVENT_STATE_SNAPSHOT).toBe("STATE_SNAPSHOT");
    expect(AGUI_EVENT_STATE_DELTA).toBe("STATE_DELTA");
    expect(THREAD_JSON_RENDER_STATE_SNAPSHOT_PAYLOAD_KIND).toBe(
      "thread_json_render.state_snapshot",
    );
    // Date-tagged, not semver — the pin must be a concrete ISO date.
    expect(AGUI_VOCABULARY_SNAPSHOT_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("round-trips a part → snapshot envelope → part identically", () => {
    const part = createTaskReviewJsonRenderFixture();
    const event = threadJsonRenderPartToStateSnapshot(part);

    expect(event).toEqual({
      type: "STATE_SNAPSHOT",
      partId: part.id,
      snapshot: part,
    });
    expect(stateSnapshotToThreadJsonRenderPart(event)).toEqual(part);
  });

  it("wraps and unwraps the pipeline payload envelope", () => {
    const part = createTaskReviewJsonRenderFixture();
    const payload = threadJsonRenderStateSnapshotPayload(part);

    expect(payload).toEqual({
      kind: "thread_json_render.state_snapshot",
      event: {
        type: "STATE_SNAPSHOT",
        partId: part.id,
        snapshot: part,
      },
    });
    expect(partFromThreadJsonRenderStateSnapshotPayload(payload)).toEqual(part);
  });

  it("ignores unrelated, malformed, and reserved-delta payloads (forward compatible)", () => {
    expect(partFromThreadJsonRenderStateSnapshotPayload(null)).toBeNull();
    expect(partFromThreadJsonRenderStateSnapshotPayload(undefined)).toBeNull();
    expect(partFromThreadJsonRenderStateSnapshotPayload("nope")).toBeNull();
    expect(partFromThreadJsonRenderStateSnapshotPayload([])).toBeNull();
    expect(
      partFromThreadJsonRenderStateSnapshotPayload({
        kind: "thread_json_render.ui_message_chunk",
        chunk: createTaskReviewJsonRenderFixture(),
      }),
    ).toBeNull();
    expect(
      partFromThreadJsonRenderStateSnapshotPayload({
        kind: "some.future.event",
      }),
    ).toBeNull();
    // A STATE_DELTA envelope (reserved, never emitted) is not a snapshot.
    const delta: ThreadJsonRenderStateDeltaEvent = {
      type: "STATE_DELTA",
      partId: "json-render:x",
      delta: [{ op: "replace", path: "/data/status", value: "ready" }],
    };
    expect(
      partFromThreadJsonRenderStateSnapshotPayload({
        kind: THREAD_JSON_RENDER_STATE_SNAPSHOT_PAYLOAD_KIND,
        event: delta,
      }),
    ).toBeNull();
  });

  it("keeps STATE_DELTA a compile-time-only reserved variant (no producer)", () => {
    // This test documents R2: the type exists so consumers can be written
    // against the union, but nothing in v1 constructs it as a wire event.
    const delta: ThreadJsonRenderStateDeltaEvent = {
      type: AGUI_EVENT_STATE_DELTA,
      partId: "json-render:reserved",
      delta: [],
    };
    expect(delta.type).toBe("STATE_DELTA");
  });
});
