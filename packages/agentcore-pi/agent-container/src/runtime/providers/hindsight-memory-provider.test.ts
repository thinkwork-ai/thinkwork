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

  it("fans recall out to every member space, deduped against the current space, with labels (THINK-261 #6)", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/memories/list")) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (url.includes("space_space-2")) {
        return new Response(
          JSON.stringify({
            memory_units: [
              {
                id: "aaaaaaaa-0000-0000-0000-00000000000a",
                text: "Acme raised pricing concerns",
                score: 1,
                type: "world",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ memory_units: [] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const provider = createHindsightMemoryProvider({
      endpoint: "https://hindsight.example.test",
      tenantId: "tenant-1",
      userId: "user-1",
      spaceId: "space-1",
      memberSpaces: [
        { id: "space-1", name: "Research" },
        { id: "space-2", name: "Sales" },
      ],
      fetchImpl,
    });

    const result = await provider.recall({ query: "acme", limit: 10 } as any);

    // 3 distinct banks (user, space-1 deduped, space-2) × list-then-recall.
    const urls: string[] = (fetchImpl as any).mock.calls.map(
      (call: unknown[]) => String(call[0]),
    );
    expect(
      urls.filter((u: string) => u.includes("/memories/list")),
    ).toHaveLength(3);
    expect(
      urls.filter((u: string) => u.endsWith("/memories/recall")),
    ).toHaveLength(3);
    expect(urls.some((u: string) => u.includes("banks/space_space-2/"))).toBe(
      true,
    );
    expect(
      urls.filter((u: string) => u.includes("banks/space_space-1/")),
    ).toHaveLength(2);

    // The member-space name rides the item as its scope label.
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({
      sourceScope: "space",
      scopeLabel: "Sales",
    });
  });

  it("drops the personal duplicate when the same content exists in a space bank (cross-bank dedupe)", async () => {
    const content = "Release codename is Bluejay.";
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/memories/list")) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (url.includes("user_user-1")) {
        return new Response(
          JSON.stringify({
            memory_units: [
              {
                id: "aaaaaaaa-0000-0000-0000-0000000000b1",
                text: content,
                score: 1,
                type: "world",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          memory_units: [
            {
              id: "aaaaaaaa-0000-0000-0000-0000000000b2",
              text: `${content}  `,
              score: 1,
              type: "world",
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const provider = createHindsightMemoryProvider({
      endpoint: "https://hindsight.example.test",
      tenantId: "tenant-1",
      userId: "user-1",
      memberSpaces: [{ id: "space-9", name: "Launch" }],
      fetchImpl,
    });

    const result = await provider.recall({ query: "codename" } as any);

    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({
      sourceScope: "space",
      scopeLabel: "Launch",
    });
  });

  it("degrades a failing space bank instead of failing the turn; reflect names surviving scopes", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("space_space-bad")) {
        return new Response("boom", { status: 400 });
      }
      if (url.endsWith("/reflect")) {
        return new Response(
          JSON.stringify({
            text: url.includes("user_")
              ? "Personal synthesis."
              : "Team synthesis.",
          }),
          { status: 200 },
        );
      }
      if (url.includes("/memories/list")) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          memory_units: url.includes("space_space-ok")
            ? [
                {
                  id: "aaaaaaaa-0000-0000-0000-0000000000c1",
                  text: "surviving space fact",
                  score: 1,
                  type: "world",
                },
              ]
            : [],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const provider = createHindsightMemoryProvider({
      endpoint: "https://hindsight.example.test",
      tenantId: "tenant-1",
      userId: "user-1",
      memberSpaces: [
        { id: "space-bad", name: "Broken" },
        { id: "space-ok", name: "Sales" },
      ],
      fetchImpl,
    });

    const recall = await provider.recall({ query: "anything" } as any);
    expect(recall.memories).toHaveLength(1);
    expect(recall.memories[0]?.scopeLabel).toBe("Sales");

    const reflect = await provider.reflect({ query: "anything" } as any);
    expect(reflect.ok).toBe(true);
    expect(reflect.text).toContain("User memory:\nPersonal synthesis.");
    expect(reflect.text).toContain("Team memory (Sales):\nTeam synthesis.");
    expect(reflect.text).not.toContain("Broken");
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
