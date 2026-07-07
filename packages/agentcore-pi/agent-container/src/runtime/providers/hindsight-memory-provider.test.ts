import { describe, expect, it, vi } from "vitest";

import {
  compareMemoryItems,
  createHindsightMemoryProvider,
} from "./hindsight-memory-provider.js";

describe("createHindsightMemoryProvider", () => {
  it("recalls user and Space banks when the invocation has a Space id", async () => {
    const fetchImpl = vi.fn(
      async () =>
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

  it("ranks observations ahead of raw units at equal score and records access counts (THINK-199)", async () => {
    const rawUnit = {
      id: "aaaaaaaa-0000-0000-0000-000000000001",
      text: "raw fact",
      score: 0.5,
      type: "world",
    };
    const observation = {
      id: "aaaaaaaa-0000-0000-0000-000000000002",
      text: "consolidated observation",
      score: 0.5,
      type: "observation",
      source_fact_ids: ["x", "y", "z"],
    };
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/memories/list")) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ memory_units: [rawUnit, observation] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const send = vi.fn(async () => ({ records: [] }));

    const provider = createHindsightMemoryProvider({
      endpoint: "https://hindsight.example.test",
      tenantId: "tenant-1",
      userId: "user-1",
      fetchImpl,
      dbClusterArn: "arn:aws:rds:cluster",
      dbSecretArn: "arn:aws:secretsmanager:secret",
      rdsDataClient: { send } as any,
    });

    const result = await provider.recall({
      query: "anything",
      limit: 10,
    } as any);

    expect(result.memories.map((m: any) => m.id)).toEqual([
      observation.id,
      rawUnit.id,
    ]);

    // send: one high-confidence lookup (empty) + one access-count UPDATE for
    // the two recalled unit ids.
    const updateCall = send.mock.calls
      .map((call: any[]) => call[0]?.input)
      .find((input: any) => input?.sql?.includes("access_count"));
    expect(updateCall).toBeTruthy();
    expect(updateCall.sql).toContain(
      "UPDATE hindsight.memory_units SET access_count",
    );
    expect(
      updateCall.parameters.map((p: any) => p.value.stringValue).sort(),
    ).toEqual([observation.id, rawUnit.id].sort());
  });

  it("access-count update failure never fails recall", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/memories/list")) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          memory_units: [
            {
              id: "aaaaaaaa-0000-0000-0000-000000000003",
              text: "fact",
              score: 1,
              type: "world",
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const send = vi.fn(async (command: any) => {
      if (command?.input?.sql?.includes("access_count")) {
        throw new Error("rds unavailable");
      }
      return { records: [] };
    });

    const provider = createHindsightMemoryProvider({
      endpoint: "https://hindsight.example.test",
      tenantId: "tenant-1",
      userId: "user-1",
      fetchImpl,
      dbClusterArn: "arn:aws:rds:cluster",
      dbSecretArn: "arn:aws:secretsmanager:secret",
      rdsDataClient: { send } as any,
    });

    const result = await provider.recall({ query: "anything" } as any);
    expect(result.memories).toHaveLength(1);
  });
});

describe("compareMemoryItems", () => {
  it("score leads; observation and proof count break ties", () => {
    const base = { content: "x" } as any;
    const higherScore = { ...base, id: "a", score: 2, factType: "world" };
    const obs = { ...base, id: "b", score: 1, factType: "observation" };
    const proved = {
      ...base,
      id: "c",
      score: 1,
      factType: "world",
      proofCount: 4,
    };
    const raw = {
      ...base,
      id: "d",
      score: 1,
      factType: "world",
      proofCount: 1,
    };

    const sorted = [raw, proved, obs, higherScore].sort(compareMemoryItems);
    expect(sorted.map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
  });
});
