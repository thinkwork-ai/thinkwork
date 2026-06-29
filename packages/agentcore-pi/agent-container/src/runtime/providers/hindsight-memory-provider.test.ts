import { describe, expect, it, vi } from "vitest";

import { createHindsightMemoryProvider } from "./hindsight-memory-provider.js";

describe("createHindsightMemoryProvider", () => {
  it("recalls user and Space banks when the invocation has a Space id", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ memory_units: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const provider = createHindsightMemoryProvider({
      endpoint: "https://hindsight.example.test",
      tenantId: "tenant-1",
      userId: "user-1",
      spaceId: "space-1",
      fetchImpl,
    });

    await provider.recall({ query: "launch code", limit: 10 } as any);

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://hindsight.example.test/v1/default/banks/user_user-1/memories/list?q=launch+code&limit=25&offset=0",
      expect.any(Object),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://hindsight.example.test/v1/default/banks/space_space-1/memories/list?q=launch+code&limit=25&offset=0",
      expect.any(Object),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://hindsight.example.test/v1/default/banks/user_user-1/memories/recall",
      expect.any(Object),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      "https://hindsight.example.test/v1/default/banks/space_space-1/memories/recall",
      expect.any(Object),
    );
  });
});
