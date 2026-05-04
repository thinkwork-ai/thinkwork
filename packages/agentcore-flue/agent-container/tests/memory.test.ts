/**
 * Plan §005 U6 — vitest coverage for memory ToolDefs.
 *
 * Uses aws-sdk-client-mock to stub `BedrockAgentCoreClient` calls.
 * The fixtures below match the real shapes of `RetrieveMemoryRecords`
 * and `ListMemoryRecords` responses so the normaliser is exercised
 * end-to-end.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  BatchCreateMemoryRecordsCommand,
  BedrockAgentCoreClient,
  CreateEventCommand,
  ListMemoryRecordsCommand,
  RetrieveMemoryRecordsCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import {
  buildMemoryTools,
  buildRecallTool,
  buildRememberTool,
  MemoryToolError,
  type MemoryToolsContext,
} from "../src/tools/memory.js";

const ACClient = mockClient(BedrockAgentCoreClient);

beforeEach(() => {
  ACClient.reset();
});
afterEach(() => {
  ACClient.reset();
});

function makeContext(
  overrides: Partial<MemoryToolsContext> = {},
): MemoryToolsContext {
  return {
    client: new BedrockAgentCoreClient({ region: "us-east-1" }),
    memoryId: "memory-id-123",
    tenantId: "tenant-abc",
    userId: "user-xyz",
    threadId: "thread-1",
    ...overrides,
  };
}

describe("buildMemoryTools — composition", () => {
  it("returns [remember, recall] in order", () => {
    const tools = buildMemoryTools(makeContext());
    expect(tools.map((t) => t.name)).toEqual(["remember", "recall"]);
    expect(tools[0]?.label).toBe("Remember");
    expect(tools[1]?.label).toBe("Recall");
  });

  it("each tool sets executionMode = sequential", () => {
    const tools = buildMemoryTools(makeContext());
    expect(tools[0]?.executionMode).toBe("sequential");
    expect(tools[1]?.executionMode).toBe("sequential");
  });
});

describe("remember — happy path", () => {
  it("writes a memory record and fires an event", async () => {
    ACClient.on(BatchCreateMemoryRecordsCommand).resolves({});
    ACClient.on(CreateEventCommand).resolves({});

    const tool = buildRememberTool(makeContext());
    const result = await tool.execute(
      "call-1",
      { fact: "User prefers dark mode", category: "preference" } as any,
    );

    expect(result.content).toEqual([
      { type: "text", text: "Remembered: User prefers dark mode" },
    ]);
    expect(result.details).toMatchObject({
      tenantId: "tenant-abc",
      userId: "user-xyz",
      namespace: "user_user-xyz",
      category: "preference",
    });

    const batchCalls = ACClient.commandCalls(BatchCreateMemoryRecordsCommand);
    expect(batchCalls).toHaveLength(1);
    const batchInput = batchCalls[0]!.args[0].input;
    expect(batchInput.memoryId).toBe("memory-id-123");
    expect(batchInput.records?.[0]?.namespaces).toEqual(["user_user-xyz"]);
    expect(batchInput.records?.[0]?.content?.text).toBe(
      "[preference] User prefers dark mode",
    );

    const eventCalls = ACClient.commandCalls(CreateEventCommand);
    expect(eventCalls).toHaveLength(1);
    const eventInput = eventCalls[0]!.args[0].input;
    expect(eventInput.actorId).toBe("user-xyz");
    expect(eventInput.sessionId).toBe("thread-1");
    expect(eventInput.payload?.[0]?.conversational?.role).toBe("USER");
    expect(eventInput.payload?.[0]?.conversational?.content?.text).toContain(
      "User prefers dark mode",
    );
  });

  it("uses memory_user_<userId> as sessionId when threadId is absent", async () => {
    ACClient.on(BatchCreateMemoryRecordsCommand).resolves({});
    ACClient.on(CreateEventCommand).resolves({});

    const tool = buildRememberTool(makeContext({ threadId: undefined }));
    await tool.execute("call-2", { fact: "anything" } as any);

    const eventInput = ACClient.commandCalls(CreateEventCommand)[0]!.args[0]
      .input;
    expect(eventInput.sessionId).toBe("memory_user_user-xyz");
  });

  it("omits the category prefix when category is not provided", async () => {
    ACClient.on(BatchCreateMemoryRecordsCommand).resolves({});
    ACClient.on(CreateEventCommand).resolves({});

    const tool = buildRememberTool(makeContext());
    await tool.execute("call-3", { fact: "Plain fact" } as any);

    const batchInput = ACClient.commandCalls(BatchCreateMemoryRecordsCommand)[0]!
      .args[0].input;
    expect(batchInput.records?.[0]?.content?.text).toBe("Plain fact");
  });
});

describe("remember — fail-closed validation", () => {
  it("throws MemoryToolError when fact is empty", async () => {
    const tool = buildRememberTool(makeContext());
    await expect(
      tool.execute("call-4", { fact: "   " } as any),
    ).rejects.toThrow(MemoryToolError);
  });

  it("throws when tenantId is missing", async () => {
    const tool = buildRememberTool(makeContext({ tenantId: "" }));
    await expect(
      tool.execute("call-5", { fact: "x" } as any),
    ).rejects.toThrow(/tenantId/);
  });

  it("throws when userId is missing", async () => {
    const tool = buildRememberTool(makeContext({ userId: "" }));
    await expect(
      tool.execute("call-6", { fact: "x" } as any),
    ).rejects.toThrow(/userId/);
  });

  it("throws when memoryId is missing", async () => {
    const tool = buildRememberTool(makeContext({ memoryId: "" }));
    await expect(
      tool.execute("call-7", { fact: "x" } as any),
    ).rejects.toThrow(/memoryId/);
  });
});

describe("recall — happy path", () => {
  it("returns formatted memories from semantic search", async () => {
    ACClient.on(RetrieveMemoryRecordsCommand).resolves({
      memoryRecordSummaries: [
        { content: { text: "User likes hot tea" }, score: 0.9 } as any,
        { content: { text: "Lives in Brooklyn" }, score: 0.7 } as any,
      ],
    });

    const tool = buildRecallTool(makeContext());
    const result = await tool.execute(
      "call-8",
      { query: "preferences" } as any,
    );
    const text = (result.content[0]! as { text: string }).text;
    expect(text).toContain("[managed]");
    expect(text).toContain("User likes hot tea");
    expect(text).toContain("Lives in Brooklyn");

    expect(ACClient.commandCalls(RetrieveMemoryRecordsCommand)).toHaveLength(1);
    expect(ACClient.commandCalls(ListMemoryRecordsCommand)).toHaveLength(0);

    const retrieveInput = ACClient.commandCalls(RetrieveMemoryRecordsCommand)[0]!
      .args[0].input;
    expect(retrieveInput.namespace).toBe("user_user-xyz");
    expect(retrieveInput.searchCriteria?.searchQuery).toBe("preferences");
  });

  it("falls back to ListMemoryRecords when semantic returns empty", async () => {
    ACClient.on(RetrieveMemoryRecordsCommand).resolves({
      memoryRecordSummaries: [],
    });
    ACClient.on(ListMemoryRecordsCommand).resolves({
      memoryRecordSummaries: [
        { content: { text: "Old fact" } } as any,
      ],
    });

    const tool = buildRecallTool(makeContext());
    const result = await tool.execute("call-9", { query: "x" } as any);
    const text = (result.content[0]! as { text: string }).text;
    expect(text).toContain("Old fact");
    expect(ACClient.commandCalls(ListMemoryRecordsCommand)).toHaveLength(1);
  });

  it("falls back to ListMemoryRecords when semantic search throws", async () => {
    ACClient.on(RetrieveMemoryRecordsCommand).rejects(
      new Error("semantic search not configured"),
    );
    ACClient.on(ListMemoryRecordsCommand).resolves({
      memoryRecordSummaries: [{ content: { text: "Listed fallback" } } as any],
    });

    const tool = buildRecallTool(makeContext());
    const result = await tool.execute("call-10", { query: "x" } as any);
    const text = (result.content[0]! as { text: string }).text;
    expect(text).toContain("Listed fallback");
  });

  it("returns 'no relevant memories' when both calls return empty", async () => {
    ACClient.on(RetrieveMemoryRecordsCommand).resolves({
      memoryRecordSummaries: [],
    });
    ACClient.on(ListMemoryRecordsCommand).resolves({
      memoryRecordSummaries: [],
    });

    const tool = buildRecallTool(makeContext());
    const result = await tool.execute("call-11", { query: "x" } as any);
    expect(result.content).toEqual([
      { type: "text", text: "No relevant memories found." },
    ]);
  });

  it("respects top_k by truncating returned records", async () => {
    ACClient.on(RetrieveMemoryRecordsCommand).resolves({
      memoryRecordSummaries: Array.from({ length: 8 }, (_, i) => ({
        content: { text: `record ${i + 1}` },
        score: 1.0 - i * 0.1,
      })) as any,
    });

    const tool = buildRecallTool(makeContext());
    const result = await tool.execute(
      "call-12",
      { query: "x", top_k: 3 } as any,
    );
    const text = (result.content[0]! as { text: string }).text;
    const lines = text.split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("record 1");
    expect(lines[2]).toContain("record 3");
  });
});

describe("recall — fail-closed validation", () => {
  it("throws when query is empty", async () => {
    const tool = buildRecallTool(makeContext());
    await expect(
      tool.execute("call-13", { query: "" } as any),
    ).rejects.toThrow(MemoryToolError);
  });

  it("throws when tenantId is missing", async () => {
    const tool = buildRecallTool(makeContext({ tenantId: "" }));
    await expect(
      tool.execute("call-14", { query: "anything" } as any),
    ).rejects.toThrow(/tenantId/);
  });

  it("throws when userId is missing", async () => {
    const tool = buildRecallTool(makeContext({ userId: "" }));
    await expect(
      tool.execute("call-15", { query: "anything" } as any),
    ).rejects.toThrow(/userId/);
  });
});

describe("recall — namespace + tenant isolation", () => {
  it("namespace key is derived from userId, not tenantId", async () => {
    ACClient.on(RetrieveMemoryRecordsCommand).resolves({
      memoryRecordSummaries: [],
    });
    ACClient.on(ListMemoryRecordsCommand).resolves({
      memoryRecordSummaries: [],
    });

    const tool = buildRecallTool(
      makeContext({ tenantId: "tenant-A", userId: "user-1" }),
    );
    await tool.execute("call-16", { query: "x" } as any);

    const retrieveInput = ACClient.commandCalls(RetrieveMemoryRecordsCommand)[0]!
      .args[0].input;
    expect(retrieveInput.namespace).toBe("user_user-1");
    expect(retrieveInput.namespace).not.toContain("tenant-A");
  });
});

describe("recall — strategy field handling", () => {
  it("reads memoryStrategyId from production SDK responses", async () => {
    ACClient.on(RetrieveMemoryRecordsCommand).resolves({
      memoryRecordSummaries: [
        {
          content: { text: "User likes hot tea" },
          memoryStrategyId: "semantic-v1",
        } as any,
      ],
    });

    const tool = buildRecallTool(makeContext());
    const result = await tool.execute("call-17", { query: "x" } as any);
    const text = (result.content[0]! as { text: string }).text;
    expect(text).toContain("[semantic-v1]");
    expect(text).toContain("User likes hot tea");
  });

  it("falls back to 'managed' when no strategy field is present", async () => {
    ACClient.on(RetrieveMemoryRecordsCommand).resolves({
      memoryRecordSummaries: [
        { content: { text: "Plain record" } } as any,
      ],
    });

    const tool = buildRecallTool(makeContext());
    const result = await tool.execute("call-18", { query: "x" } as any);
    const text = (result.content[0]! as { text: string }).text;
    expect(text).toContain("[managed]");
  });
});

describe("recall — both calls fail surfaces semantic error", () => {
  it("throws MemoryToolError naming the original semantic failure when both calls fail", async () => {
    ACClient.on(RetrieveMemoryRecordsCommand).rejects(
      new Error("AccessDeniedException: not authorized to RetrieveMemoryRecords"),
    );
    ACClient.on(ListMemoryRecordsCommand).rejects(
      new Error("AccessDeniedException: not authorized to ListMemoryRecords"),
    );

    const tool = buildRecallTool(makeContext());
    await expect(
      tool.execute("call-19", { query: "x" } as any),
    ).rejects.toThrow(/AccessDeniedException.*RetrieveMemoryRecords/);
  });
});

describe("recall — list fallback respects topK", () => {
  it("passes maxResults: topK to ListMemoryRecords", async () => {
    ACClient.on(RetrieveMemoryRecordsCommand).resolves({
      memoryRecordSummaries: [],
    });
    ACClient.on(ListMemoryRecordsCommand).resolves({
      memoryRecordSummaries: [],
    });

    const tool = buildRecallTool(makeContext());
    await tool.execute("call-20", { query: "x", top_k: 5 } as any);

    const listInput = ACClient.commandCalls(ListMemoryRecordsCommand)[0]!
      .args[0].input;
    expect(listInput.maxResults).toBe(5);
  });
});
