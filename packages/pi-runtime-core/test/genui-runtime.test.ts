import { describe, expect, it } from "vitest";
import { createTaskReviewGenUIFixture } from "@thinkwork/genui";

import {
  THREAD_GENUI_ACTIVITY_PAYLOAD_KIND,
  normalizeRuntimeThreadGenUIPart,
  threadGenUIActivityEvent,
} from "../src/genui-runtime.js";

describe("runtime Thread GenUI helper", () => {
  it("accepts a valid canonical data-genui part", () => {
    const fixture = createTaskReviewGenUIFixture();
    const result = normalizeRuntimeThreadGenUIPart(fixture);

    expect(result.ok).toBe(true);
    expect(result.part).toEqual(fixture);
  });

  it("wraps valid data with a stable fallback part id", () => {
    const fixture = createTaskReviewGenUIFixture();
    const result = normalizeRuntimeThreadGenUIPart(
      fixture.data,
      "genui:tool:0",
    );

    expect(result.ok).toBe(true);
    expect(result.part).toMatchObject({
      type: "data-genui",
      id: "genui:tool:0",
      data: fixture.data,
    });
  });

  it("turns invalid candidates into diagnostic data-genui parts", () => {
    const result = normalizeRuntimeThreadGenUIPart({ nope: true }, "genui:bad");

    expect(result.ok).toBe(false);
    expect(result.part).toMatchObject({
      type: "data-genui",
      id: "genui:bad",
      data: {
        status: "invalid",
        mobileFallback: {
          title: "Generated UI unavailable",
        },
      },
    });
    expect(result.part.data.diagnostics?.[0]?.severity).toBe("error");
  });

  it("builds the live activity UIMessage chunk envelope", () => {
    const fixture = createTaskReviewGenUIFixture();
    const event = threadGenUIActivityEvent(fixture);

    expect(event).toMatchObject({
      eventType: "ui_message_chunk",
      stream: "ui",
      payload: {
        kind: THREAD_GENUI_ACTIVITY_PAYLOAD_KIND,
        chunk: fixture,
      },
    });
  });
});
