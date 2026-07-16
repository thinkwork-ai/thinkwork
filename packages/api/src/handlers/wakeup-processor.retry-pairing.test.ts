import { describe, expect, it, vi } from "vitest";
import { resolveRetryTriggeringMessageId } from "./wakeup-processor.js";

const ORIGIN_TURN_ID = "55555555-5555-5555-5555-555555555555";
const MESSAGE_ID = "66666666-6666-6666-6666-666666666666";

describe("resolveRetryTriggeringMessageId (THINK-307 R6)", () => {
  it("returns the origin turn's triggering_message_id for a retry wakeup (AE4)", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{ triggering_message_id: MESSAGE_ID }],
    });

    const result = await resolveRetryTriggeringMessageId(
      { execute },
      null,
      ORIGIN_TURN_ID,
    );

    expect(result).toBe(MESSAGE_ID);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns null without a lookup when the wakeup carries its own messageId (chat regression guard)", async () => {
    const execute = vi.fn();

    const result = await resolveRetryTriggeringMessageId(
      { execute },
      MESSAGE_ID,
      ORIGIN_TURN_ID,
    );

    expect(result).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns null without a lookup for non-retry wakeups (no originTurnId)", async () => {
    const execute = vi.fn();

    const result = await resolveRetryTriggeringMessageId(
      { execute },
      null,
      undefined,
    );

    expect(result).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns null when the origin turn has no triggering_message_id (no throw)", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{ triggering_message_id: null }],
    });

    await expect(
      resolveRetryTriggeringMessageId({ execute }, null, ORIGIN_TURN_ID),
    ).resolves.toBeNull();
  });

  it("returns null when the origin turn is missing", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });

    await expect(
      resolveRetryTriggeringMessageId({ execute }, null, ORIGIN_TURN_ID),
    ).resolves.toBeNull();
  });

  it("returns null when the lookup throws — pairing never blocks turn creation", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("db down"));

    await expect(
      resolveRetryTriggeringMessageId({ execute }, null, ORIGIN_TURN_ID),
    ).resolves.toBeNull();
  });
});
