import { describe, expect, it, vi } from "vitest";

import { runSubscriptionInvalidationWorker } from "./subscription-invalidation.js";

describe("subscription invalidation worker", () => {
  it("drains a bounded batch and reports redacted totals", async () => {
    const process = vi.fn(async () => ({ processed: 2, retried: 1 }));
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    await expect(
      runSubscriptionInvalidationWorker({ limit: 50 }, process),
    ).resolves.toEqual({ processed: 2, retried: 1 });
    expect(process).toHaveBeenCalledWith({ limit: 50 });
    expect(infoSpy).toHaveBeenCalledWith(
      "[subscription-invalidation] drain complete",
      { processed: 2, retried: 1 },
    );
    infoSpy.mockRestore();
  });

  it("uses the safe default for an invalid requested limit", async () => {
    const process = vi.fn(async () => ({ processed: 0, retried: 0 }));
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    await runSubscriptionInvalidationWorker({ limit: 1_000 }, process);

    expect(process).toHaveBeenCalledWith({ limit: 25 });
    infoSpy.mockRestore();
  });
});
