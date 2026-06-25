/**
 * Flag-time thread snapshot builder tests (Evaluations Trust Core U7).
 *
 * The builder is pure: rows in, payload shapes + completeness out. The
 * resolver contract (tenant triangle, S3 write ordering) is covered in
 * src/graphql/resolvers/evaluations/flag-thread.test.ts.
 */

import { describe, expect, it } from "vitest";
import {
  buildTraceEvidencePayload,
  buildFlaggedCaseCore,
  buildThreadSnapshot,
  flaggedCaseIdBase,
  normalizeSnapshotMessage,
  writeFlaggedCasePayloads,
  type ThreadMessageRow,
} from "./thread-snapshot.js";
import {
  assertValidCaseId,
  evalDatasetCasePayloadKey,
  parseEvalDatasetCase,
  serializeEvalDatasetCase,
  type DatasetStorage,
} from "./dataset-store.js";

function msg(
  over: Partial<ThreadMessageRow> & { id: string },
): ThreadMessageRow {
  return {
    role: "user",
    content: "hello",
    parts: null,
    tool_calls: null,
    tool_results: null,
    created_at: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

const baseTurn = {
  id: "33333333-3333-4333-8333-333333333333",
  started_at: "2026-06-01T00:02:00.000Z",
  finished_at: "2026-06-01T00:03:00.000Z",
  context_snapshot: null,
};

describe("normalizeSnapshotMessage", () => {
  it("lowercases roles and keeps content + parts", () => {
    const normalized = normalizeSnapshotMessage(
      msg({
        id: "m1",
        role: "USER",
        content: "Hi",
        parts: [{ type: "text", text: "Hi" }],
      }),
    );
    expect(normalized.role).toBe("user");
    expect(normalized.content).toBe("Hi");
    expect(normalized.parts).toEqual([{ type: "text", text: "Hi" }]);
    expect(normalized.created_at).toBe("2026-06-01T00:00:00.000Z");
  });

  it("derives content from text parts when the content column is null (parts precedence)", () => {
    const normalized = normalizeSnapshotMessage(
      msg({
        id: "m1",
        role: "assistant",
        content: null,
        parts: [
          { type: "reasoning", text: "thinking…" },
          { type: "text", text: "part one" },
          { type: "response", text: "part two" },
        ],
      }),
    );
    expect(normalized.content).toBe("part one\n\npart two");
  });

  it("treats an empty parts array as no parts", () => {
    const normalized = normalizeSnapshotMessage(
      msg({ id: "m1", content: "plain", parts: [] }),
    );
    expect(normalized.parts).toBeNull();
    expect(normalized.content).toBe("plain");
  });
});

describe("buildThreadSnapshot — history window + query", () => {
  it("captures history up to and including the flagged turn and derives the query from the flagged user message", () => {
    const rows = [
      msg({
        id: "m1",
        role: "user",
        content: "first ask",
        created_at: "2026-06-01T00:00:00.000Z",
      }),
      msg({
        id: "m2",
        role: "assistant",
        content: "first answer",
        created_at: "2026-06-01T00:01:00.000Z",
      }),
      msg({
        id: "m3",
        role: "user",
        content: "the flagged ask",
        created_at: "2026-06-01T00:01:30.000Z",
      }),
      msg({
        id: "m4",
        role: "assistant",
        content: "the bad answer",
        created_at: "2026-06-01T00:02:30.000Z",
      }),
      // After the turn finished — excluded from the window.
      msg({
        id: "m5",
        role: "user",
        content: "later follow-up",
        created_at: "2026-06-01T00:10:00.000Z",
      }),
    ];
    const snapshot = buildThreadSnapshot({ messages: rows, turn: baseTurn });
    expect(snapshot.history.messages.map((m) => m.id)).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
    expect(snapshot.history.flagged_message_id).toBe("m3");
    expect(snapshot.query).toBe("the flagged ask");
    expect(snapshot.history.dropped_oldest_count).toBe(0);
    expect(snapshot.completeness).toEqual({
      history: true,
      workspace: false,
      traces: false,
      truncated: false,
    });
  });

  it("falls back to the last user message in the window when the turn has no started_at", () => {
    const rows = [
      msg({
        id: "m1",
        role: "user",
        content: "ask",
        created_at: "2026-06-01T00:00:00.000Z",
      }),
    ];
    const snapshot = buildThreadSnapshot({
      messages: rows,
      turn: { ...baseTurn, started_at: null, finished_at: null },
    });
    expect(snapshot.history.flagged_message_id).toBe("m1");
    expect(snapshot.query).toBe("ask");
  });

  it("degrades to an empty query when no user message exists (scheduled turn)", () => {
    const rows = [
      msg({
        id: "m1",
        role: "assistant",
        content: "proactive note",
        created_at: "2026-06-01T00:00:30.000Z",
      }),
    ];
    const snapshot = buildThreadSnapshot({ messages: rows, turn: baseTurn });
    expect(snapshot.query).toBe("");
    expect(snapshot.history.flagged_message_id).toBeNull();
    expect(snapshot.completeness.history).toBe(true);
  });
});

describe("buildThreadSnapshot — size cap / truncation", () => {
  it("drops oldest messages first at the cap, keeps the flagged message, and records the dropped count", () => {
    const big = "x".repeat(400);
    const rows = [
      ...Array.from({ length: 10 }, (_, i) =>
        msg({
          id: `old-${i}`,
          role: "assistant",
          content: big,
          created_at: `2026-06-01T00:00:0${i}.000Z`,
        }),
      ),
      msg({
        id: "flagged",
        role: "user",
        content: "the ask",
        created_at: "2026-06-01T00:01:00.000Z",
      }),
      msg({
        id: "answer",
        role: "assistant",
        content: big,
        created_at: "2026-06-01T00:02:30.000Z",
      }),
    ];
    const snapshot = buildThreadSnapshot({
      messages: rows,
      turn: baseTurn,
      capBytes: 2_000,
    });
    expect(snapshot.history.dropped_oldest_count).toBeGreaterThan(0);
    expect(snapshot.completeness.truncated).toBe(true);
    const ids = snapshot.history.messages.map((m) => m.id);
    expect(ids).toContain("flagged");
    // Oldest-first: whatever survives is a suffix of the window plus the
    // flagged message.
    expect(ids[0]).not.toBe("old-0");
    expect(snapshot.history.flagged_message_id).toBe("flagged");
  });

  it("drops an over-cap workspace projection whole and flags truncation", () => {
    const snapshot = buildThreadSnapshot({
      messages: [msg({ id: "m1" })],
      turn: {
        ...baseTurn,
        context_snapshot: {
          workspace_projection: { renderedPrefix: "p/".repeat(4_000) },
        },
      },
      capBytes: 1_000,
    });
    expect(snapshot.workspace).toBeNull();
    expect(snapshot.completeness.workspace).toBe(false);
    expect(snapshot.completeness.truncated).toBe(true);
  });
});

describe("buildThreadSnapshot — workspace projection presence/absence", () => {
  it("captures context_snapshot.workspace_projection when present (object form)", () => {
    const projection = {
      renderedPrefix: "tenants/acme/threads/t1/",
      sources: [],
    };
    const snapshot = buildThreadSnapshot({
      messages: [msg({ id: "m1" })],
      turn: {
        ...baseTurn,
        context_snapshot: { workspace_projection: projection },
      },
    });
    expect(snapshot.workspace).toEqual(projection);
    expect(snapshot.completeness.workspace).toBe(true);
  });

  it("parses a stringified context_snapshot (AWSJSON round-trip)", () => {
    const snapshot = buildThreadSnapshot({
      messages: [msg({ id: "m1" })],
      turn: {
        ...baseTurn,
        context_snapshot: JSON.stringify({
          workspace_projection: { renderedPrefix: "p/" },
        }),
      },
    });
    expect(snapshot.workspace).toEqual({ renderedPrefix: "p/" });
  });

  it("pre-THNK-10 turn (no workspace_projection) → history-only completeness, never blocked", () => {
    const snapshot = buildThreadSnapshot({
      messages: [msg({ id: "m1" })],
      turn: { ...baseTurn, context_snapshot: { something_else: true } },
    });
    expect(snapshot.workspace).toBeNull();
    expect(snapshot.completeness).toEqual({
      history: true,
      workspace: false,
      traces: false,
      truncated: false,
    });
  });
});

describe("buildThreadSnapshot — tool trace extraction", () => {
  it("extracts tool_calls/tool_results from message rows into the traces payload", () => {
    const rows = [
      msg({ id: "m1", role: "user", content: "ask" }),
      msg({
        id: "m2",
        role: "assistant",
        content: "done",
        created_at: "2026-06-01T00:02:30.000Z",
        tool_calls: [{ name: "read", args: { path: "x" } }],
        tool_results: [{ name: "read", output: "y" }],
      }),
    ];
    const snapshot = buildThreadSnapshot({ messages: rows, turn: baseTurn });
    expect(snapshot.traces).not.toBeNull();
    expect(snapshot.traces?.spans_included).toBe(false);
    expect(snapshot.traces?.tool_traces).toEqual([
      {
        message_id: "m2",
        role: "assistant",
        created_at: "2026-06-01T00:02:30.000Z",
        tool_calls: [{ name: "read", args: { path: "x" } }],
        tool_results: [{ name: "read", output: "y" }],
      },
    ]);
    expect(snapshot.completeness.traces).toBe(true);
  });

  it("marks traces absent when no message carries tool data", () => {
    const snapshot = buildThreadSnapshot({
      messages: [msg({ id: "m1" })],
      turn: baseTurn,
    });
    expect(snapshot.traces).toBeNull();
    expect(snapshot.completeness.traces).toBe(false);
  });
});

describe("buildTraceEvidencePayload", () => {
  it("stores safe canonical trace summaries and source references without raw payload fields", () => {
    const payload = buildTraceEvidencePayload({
      rows: [
        {
          id: "trace-event-1",
          trace_run_id: "trace-run-1",
          event_type: "model_invocation",
          event_status: "succeeded",
          request_id: "bedrock-request-1",
          parent_request_id: "turn-1",
          observed_at: "2026-06-01T00:02:00.000Z",
          duration_ms: 250,
          payload_summary: {
            model: "anthropic.claude-haiku",
            input_tokens: 12,
            output_tokens: 4,
            raw_prompt: "secret customer prompt",
            tool_input: { cardNumber: "4111" },
          },
          metadata: {
            source: "bedrock_invocation_log",
          },
          reconciliation_state: "invocation-reconciled",
          reconciliation_source: "invocation",
          source_evidence: [
            {
              id: "source-1",
              sourceType: "bedrock_invocation_log",
              sourceSystem: "aws.bedrock",
              sourceId: "bedrock-request-1",
              uri: "cloudwatch://group/stream",
              observedAt: "2026-06-01T00:02:00.000Z",
              redactionState: "summary_only",
              summary: {
                model: "anthropic.claude-haiku",
                raw_payload: "should not be copied",
              },
              metadata: { requestId: "bedrock-request-1" },
            },
          ],
        },
      ],
    });
    expect(payload).toMatchObject({
      source: "trace_ledger",
      gaps: [],
      dropped_oldest_count: 0,
      events: [
        {
          id: "trace-event-1",
          event_type: "model_invocation",
          request_id: "bedrock-request-1",
          safe_summary: {
            model: "anthropic.claude-haiku",
            input_tokens: 12,
            output_tokens: 4,
            omitted_payload_keys: ["raw_prompt", "tool_input"],
          },
          reconciliation_state: "invocation-reconciled",
          reconciliation_source: "invocation",
          source_references: [
            {
              id: "source-1",
              source_type: "bedrock_invocation_log",
              source_system: "aws.bedrock",
              source_id: "bedrock-request-1",
              safe_summary: {
                model: "anthropic.claude-haiku",
                omitted_payload_keys: ["raw_payload"],
              },
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toContain("secret customer prompt");
    expect(JSON.stringify(payload)).not.toContain("4111");
    expect(JSON.stringify(payload)).not.toContain("should not be copied");
  });

  it("captures explicit trace lookup gaps without pretending evidence exists", () => {
    const payload = buildTraceEvidencePayload({
      gap: {
        code: "lookup_failed",
        source: "trace_ledger",
        message: "Trace ledger evidence lookup failed at flag time: timeout",
      },
    });
    expect(payload).toEqual({
      source: "trace_ledger",
      events: [],
      gaps: [
        {
          code: "lookup_failed",
          source: "trace_ledger",
          message: "Trace ledger evidence lookup failed at flag time: timeout",
        },
      ],
      dropped_oldest_count: 0,
    });
  });
});

describe("writeFlaggedCasePayloads", () => {
  function makeStorage() {
    const objects = new Map<string, string>();
    const storage: DatasetStorage = {
      async read(key) {
        return objects.get(key) ?? null;
      },
      async write(key, content) {
        objects.set(key, content);
      },
      async delete(key) {
        objects.delete(key);
      },
      async list(prefix) {
        return [...objects.keys()].filter((k) => k.startsWith(prefix));
      },
    };
    return { storage, objects };
  }

  const ctx = { tenantId: "tenant-1", tenantSlug: "acme", slug: "flags" };

  it("writes history always and workspace/traces only when captured", async () => {
    const { storage, objects } = makeStorage();
    const snapshot = buildThreadSnapshot({
      messages: [msg({ id: "m1" })],
      turn: baseTurn,
    });
    const keys = await writeFlaggedCasePayloads(
      ctx,
      "case-1",
      snapshot,
      storage,
    );
    expect(keys).toEqual([
      evalDatasetCasePayloadKey("acme", "flags", "case-1", "history"),
    ]);
    expect(objects.size).toBe(1);
    const history = JSON.parse(objects.get(keys[0]) as string) as Record<
      string,
      unknown
    >;
    expect(history.flagged_message_id).toBe("m1");
  });

  it("writes all three objects for a full snapshot", async () => {
    const { storage, objects } = makeStorage();
    const snapshot = buildThreadSnapshot({
      messages: [
        msg({ id: "m1" }),
        msg({
          id: "m2",
          role: "assistant",
          content: "done",
          created_at: "2026-06-01T00:02:30.000Z",
          tool_calls: [{ name: "read" }],
        }),
      ],
      turn: {
        ...baseTurn,
        context_snapshot: { workspace_projection: { renderedPrefix: "p/" } },
      },
    });
    const keys = await writeFlaggedCasePayloads(
      ctx,
      "case-1",
      snapshot,
      storage,
    );
    expect(keys).toHaveLength(3);
    expect(objects.size).toBe(3);
    for (const key of keys) {
      expect(
        key.startsWith(
          "tenants/acme/eval-datasets/flags/cases/case-1/payload/",
        ),
      ).toBe(true);
    }
  });

  it("writes trace-evidence when canonical trace evidence was captured", async () => {
    const { storage, objects } = makeStorage();
    const snapshot = buildThreadSnapshot({
      messages: [msg({ id: "m1" })],
      turn: baseTurn,
      traceEvidenceRows: [
        {
          id: "trace-event-1",
          event_type: "model_invocation",
          event_status: "succeeded",
          request_id: "turn-1",
          payload_summary: { model: "anthropic.claude-haiku" },
        },
      ],
    });
    const keys = await writeFlaggedCasePayloads(
      ctx,
      "case-1",
      snapshot,
      storage,
    );
    expect(keys).toEqual([
      evalDatasetCasePayloadKey("acme", "flags", "case-1", "history"),
      evalDatasetCasePayloadKey("acme", "flags", "case-1", "trace-evidence"),
    ]);
    expect(objects.size).toBe(2);
    const traceEvidence = JSON.parse(objects.get(keys[1]) as string) as Record<
      string,
      unknown
    >;
    expect(traceEvidence).toMatchObject({
      source: "trace_ledger",
      events: [{ id: "trace-event-1" }],
    });
    expect(snapshot.completeness.traces).toBe(true);
  });
});

describe("flagged case identity + case file", () => {
  it("flaggedCaseIdBase is deterministic, short, and a valid case id", () => {
    const id = flaggedCaseIdBase(
      "11111111-2222-4333-8444-555555555555",
      "aaaabbbb-cccc-4ddd-8eee-ffff00001111",
    );
    expect(id).toBe("flagged-11111111-aaaabbbb");
    expect(() => assertValidCaseId(id)).not.toThrow();
    expect(
      flaggedCaseIdBase(
        "11111111-2222-4333-8444-555555555555",
        "aaaabbbb-cccc-4ddd-8eee-ffff00001111",
      ),
    ).toBe(id);
  });

  it("buildFlaggedCaseCore stamps provenance, completeness, rubric assertion, and outcome tag — and round-trips through the case file format", () => {
    const snapshot = buildThreadSnapshot({
      messages: [msg({ id: "m1", content: "the ask" })],
      turn: baseTurn,
    });
    const core = buildFlaggedCaseCore({
      caseId: "flagged-abc-def",
      threadId: "thread-1",
      turnId: "turn-1",
      threadTitle: "Quarterly numbers gone wrong",
      snapshot,
      resolutionTarget: "Should refuse to fabricate figures.",
      outcomeKind: "quality",
      flaggedAt: "2026-06-12T00:00:00.000Z",
    });
    expect(core.category).toBe("flagged-thread");
    expect(core.query).toBe("the ask");
    expect(core.tags).toEqual(["flagged-thread", "quality"]);
    expect(core.assertions).toEqual([
      { type: "llm-rubric", value: "Should refuse to fabricate figures." },
    ]);
    expect(core.source).toEqual({
      source_thread_id: "thread-1",
      source_turn_id: "turn-1",
      flagged_at: "2026-06-12T00:00:00.000Z",
    });
    expect(core.completeness).toEqual(snapshot.completeness);

    // The flagged block survives the canonical serialize → parse round
    // trip (AE5: the case file is self-describing without the thread).
    const parsed = parseEvalDatasetCase(serializeEvalDatasetCase(core, null));
    expect(parsed.core.source).toEqual(core.source);
    expect(parsed.core.resolution_target).toBe(
      "Should refuse to fabricate figures.",
    );
    expect(parsed.core.outcome_kind).toBe("quality");
    expect(parsed.core.completeness).toEqual(snapshot.completeness);
  });

  it("authored case files (no flagged block) round-trip without gaining flagged fields", () => {
    const parsed = parseEvalDatasetCase(
      JSON.stringify({
        case_id: "authored-1",
        name: "Authored",
        category: "general",
        query: "q",
      }),
    );
    expect(parsed.core.source).toBeUndefined();
    expect(parsed.core.resolution_target).toBeUndefined();
    expect(parsed.core.outcome_kind).toBeUndefined();
    expect(parsed.core.completeness).toBeUndefined();
    const serialized = serializeEvalDatasetCase(parsed.core, null);
    expect(serialized).not.toContain("resolution_target");
    expect(serialized).not.toContain("completeness");
  });
});
