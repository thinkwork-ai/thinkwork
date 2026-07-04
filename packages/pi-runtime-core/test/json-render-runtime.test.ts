import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTaskReviewJsonRenderFixture } from "@thinkwork/thread-json-render";

import {
  partFromThreadJsonRenderStateSnapshotPayload,
  THREAD_JSON_RENDER_STATE_SNAPSHOT_PAYLOAD_KIND,
} from "@thinkwork/thread-json-render";
import {
  EMIT_JSON_RENDER_UI_TOOL_NAME,
  THREAD_JSON_RENDER_ACTIVITY_PAYLOAD_KIND,
  THREAD_JSON_RENDER_STATE_SNAPSHOT_ACTIVITY_EVENT_TYPE,
  buildEmitJsonRenderUiTool,
  decideEmitBinding,
  extractEmitJsonRenderToolPart,
  listMcpBindingCandidates,
  normalizeRuntimeThreadJsonRenderInput,
  threadJsonRenderActivityEvent,
  threadJsonRenderStateSnapshotActivityEvent,
  wrapEmitToolWithBindingFeedback,
  type CanvasBindingSourceInvocation,
  type EmitBindingLogEntry,
} from "../src/json-render-runtime.js";

describe("runtime Thread json-render helper", () => {
  it("accepts the checked-in valid-card fixture as trusted runtime UI", () => {
    const fixture = readJsonFixture("valid-card.json");
    const result = normalizeRuntimeThreadJsonRenderInput(fixture);

    expect(result.ok).toBe(true);
    expect(result.part).toMatchObject({
      type: "data-json-render",
      id: "json-render:primitive:review",
      data: {
        specHash: "json-render-fnv1a:00b0bb9e",
        mobileFallback: {
          title: "Pipeline health",
          summary: "All checks are ready.",
        },
      },
    });
  });

  it("accepts a valid canonical data-json-render part", () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const result = normalizeRuntimeThreadJsonRenderInput(fixture);

    expect(result.ok).toBe(true);
    expect(result.part).toEqual(fixture);
  });

  it("wraps valid tool input with a stable fallback part id", () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const result = normalizeRuntimeThreadJsonRenderInput(
      {
        spec: fixture.data.spec,
        mobileFallback: fixture.data.mobileFallback,
        durableActions: fixture.data.durableActions,
      },
      "json-render:tool:0",
    );

    expect(result.ok).toBe(true);
    expect(result.part).toMatchObject({
      type: "data-json-render",
      id: "json-render:tool:0",
      data: {
        schemaVersion: "thread-json-render/v1",
        catalogVersion: "thread-json-render-catalog/v1",
        spec: fixture.data.spec,
        mobileFallback: fixture.data.mobileFallback,
      },
    });
    expect(result.part?.data.specHash).toBe(fixture.data.specHash);
  });

  it("fills omitted nullable upstream shadcn props before validation", () => {
    const result = normalizeRuntimeThreadJsonRenderInput({
      spec: {
        root: "card",
        elements: {
          card: {
            type: "Card",
            props: {
              title: "THNK-78 Primitive Smoke",
              description: "Generated through deployed Pi emit_json_render_ui",
              centered: false,
            },
            children: ["stack"],
          },
          stack: {
            type: "Stack",
            props: {
              direction: "vertical",
              gap: "sm",
            },
            children: ["heading", "summary", "approve"],
          },
          heading: {
            type: "Heading",
            props: {
              text: "json-render is live",
              level: "h3",
            },
            children: [],
          },
          summary: {
            type: "Text",
            props: {
              text: "Card, Stack, Heading, Text, and Button are rendered.",
              variant: "body",
            },
            children: [],
          },
          approve: {
            type: "Button",
            props: {
              label: "Looks good",
              variant: "primary",
            },
            children: [],
          },
        },
      },
      mobileFallback: {
        title: "json-render is live",
        summary: "Primitive smoke succeeded.",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.part).toMatchObject({
      type: "data-json-render",
      data: {
        spec: {
          elements: {
            card: {
              props: {
                maxWidth: null,
                className: null,
              },
            },
            stack: {
              props: {
                align: null,
                justify: null,
                className: null,
              },
            },
            approve: {
              props: {
                disabled: null,
              },
            },
          },
        },
      },
    });
  });

  it("rejects invalid candidates instead of producing diagnostic UI parts", () => {
    const result = normalizeRuntimeThreadJsonRenderInput(
      { nope: true },
      "json-render:bad",
    );

    expect(result.ok).toBe(false);
    expect(result.part).toBeUndefined();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("rejects legacy component JSON and markdown fences as trusted runtime UI", () => {
    const legacy = readJsonFixture("invalid-legacy-component.json");
    const fenced = readMarkdownFixture("invalid-fenced-markdown.md");

    const legacyResult = normalizeRuntimeThreadJsonRenderInput(
      legacy,
      "json-render:legacy",
    );
    const fencedResult = normalizeRuntimeThreadJsonRenderInput(
      fenced,
      "json-render:fenced",
    );

    expect(legacyResult.ok).toBe(false);
    expect(legacyResult.part).toBeUndefined();
    expect(fencedResult.ok).toBe(false);
    expect(fencedResult.part).toBeUndefined();
  });

  it("builds the live activity UIMessage chunk envelope", () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const event = threadJsonRenderActivityEvent(fixture);

    expect(event).toMatchObject({
      eventType: "ui_message_chunk",
      stream: "ui",
      payload: {
        kind: THREAD_JSON_RENDER_ACTIVITY_PAYLOAD_KIND,
        chunk: fixture,
      },
    });
  });

  it("builds an additive AG-UI STATE_SNAPSHOT activity event that round-trips the part", () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const event = threadJsonRenderStateSnapshotActivityEvent(fixture);

    expect(event).toMatchObject({
      eventType: THREAD_JSON_RENDER_STATE_SNAPSHOT_ACTIVITY_EVENT_TYPE,
      stream: "ui",
      payload: {
        kind: THREAD_JSON_RENDER_STATE_SNAPSHOT_PAYLOAD_KIND,
        event: {
          type: "STATE_SNAPSHOT",
          partId: fixture.id,
          snapshot: fixture,
        },
      },
    });
    // The snapshot round-trips to exactly the part the legacy chunk carries.
    expect(partFromThreadJsonRenderStateSnapshotPayload(event.payload)).toEqual(
      fixture,
    );
    // Legacy and snapshot events describe the same part id → the web fold
    // merges them by id (idempotent dual-emission).
    const legacy = threadJsonRenderActivityEvent(fixture);
    expect((legacy.payload as { chunk: { id: string } }).chunk.id).toBe(
      partFromThreadJsonRenderStateSnapshotPayload(event.payload)?.id,
    );
  });

  it("exposes a narrow emit_json_render_ui tool", async () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const tool = buildEmitJsonRenderUiTool();

    expect(tool.name).toBe(EMIT_JSON_RENDER_UI_TOOL_NAME);
    expect(tool.description).toContain("result.list collections");
    expect(tool.description).toContain("Work Items");
    expect(tool.description).toContain("user-question summaries");
    expect(tool.description).toContain("blocking clarifications");
    expect(tool.description).toContain("ask_user_question");
    expect(tool.description).toContain("OAuth tokens");
    expect(tool.description).toContain("raw connector payloads");
    expect(tool.description).toContain("result.list item action ids");
    expect(tool.description).toContain("matching durableActions descriptors");
    expect(tool.description).toContain('target "work_item_status"');
    expect(tool.parameters.properties.durableActions.description).toContain(
      "Required for actionable approval/review/form/result-list UI",
    );
    expect(tool.parameters.properties.durableActions.description).toContain(
      "raw connector payloads",
    );

    const result = await tool.execute("call-1", {
      spec: fixture.data.spec,
      mobileFallback: fixture.data.mobileFallback,
      durableActions: fixture.data.durableActions,
    });

    const part = extractEmitJsonRenderToolPart(result);
    expect(part).toMatchObject({
      type: "data-json-render",
      id: expect.stringMatching(/^json-render:/),
      data: {
        spec: fixture.data.spec,
        mobileFallback: fixture.data.mobileFallback,
        durableActions: fixture.data.durableActions,
        specHash: fixture.data.specHash,
      },
    });
  });
});

describe("emit binding feedback loop (THINK-145)", () => {
  const mcpInvocation = (
    id: string,
    server: string,
    tool: string,
    overrides: Partial<CanvasBindingSourceInvocation> = {},
  ): CanvasBindingSourceInvocation => ({
    id,
    status: "ok",
    is_error: false,
    args: { some: "arg" },
    result: {
      details: { mcp_server: server, mcp_tool_name: tool, raw: { rows: [] } },
    },
    ...overrides,
  });

  it("lists only completed MCP invocations as bindable candidates", () => {
    const candidates = listMcpBindingCandidates([
      mcpInvocation(
        "functions.mcp_twenty--crm_execute_tool:15",
        "twenty-crm",
        "execute_tool",
      ),
      // errored MCP call → excluded
      mcpInvocation(
        "functions.mcp_twenty--crm_execute_tool:16",
        "twenty-crm",
        "execute_tool",
        {
          is_error: true,
          status: "error",
        },
      ),
      // non-MCP tool result → excluded
      { id: "functions.bash:1", status: "ok", result: { details: {} } },
    ]);
    expect(candidates).toEqual([
      {
        id: "functions.mcp_twenty--crm_execute_tool:15",
        server: "twenty-crm",
        tool: "execute_tool",
      },
    ]);
  });

  const textOf = (result: unknown): string =>
    (result as { content: { text: string }[] }).content
      .map((c) => c.text)
      .join("\n");
  const partOf = (result: unknown) => extractEmitJsonRenderToolPart(result);

  it("accepts + confirms the binding when a valid sourceToolCallId is passed", () => {
    const enforcement = decideEmitBinding({
      partId: "json-render:p1",
      sourceToolCallId: "functions.mcp_twenty--crm_execute_tool:15",
      alreadyRejected: false,
      toolInvocations: [
        mcpInvocation(
          "functions.mcp_twenty--crm_execute_tool:15",
          "twenty-crm",
          "execute_tool",
        ),
      ],
    });
    expect(enforcement.decision).toBe("accept");
    expect(enforcement).toMatchObject({
      reason: "bound",
      confirmText: "Data-source binding recorded: twenty-crm/execute_tool.",
    });
  });

  it("rejects with the exact candidate ids when unbound with MCP candidates", () => {
    const enforcement = decideEmitBinding({
      partId: "json-render:p1",
      sourceToolCallId: undefined,
      alreadyRejected: false,
      toolInvocations: [
        mcpInvocation(
          "functions.mcp_twenty--crm_execute_tool:15",
          "twenty-crm",
          "execute_tool",
        ),
        mcpInvocation("functions.mcp_github_search:3", "github", "search"),
      ],
    });
    expect(enforcement.decision).toBe("reject");
    if (enforcement.decision !== "reject") throw new Error("expected reject");
    expect(enforcement.candidateCount).toBe(2);
    expect(enforcement.text).toContain("was NOT accepted");
    expect(enforcement.text).toContain("Re-emit the SAME id");
    expect(enforcement.text).toContain('sourceToolCallId: "none"');
    expect(enforcement.text).toContain(
      "functions.mcp_twenty--crm_execute_tool:15 — twenty-crm/execute_tool",
    );
    expect(enforcement.text).toContain(
      "functions.mcp_github_search:3 — github/search",
    );
  });

  it("accepts without enforcement when no MCP invocations exist (static UI)", () => {
    const enforcement = decideEmitBinding({
      partId: "json-render:p1",
      sourceToolCallId: undefined,
      alreadyRejected: false,
      toolInvocations: [{ id: "functions.bash:1", status: "ok", result: {} }],
    });
    expect(enforcement).toEqual({
      decision: "accept",
      reason: "no_candidates",
    });
  });

  it('accepts unbound when sourceToolCallId is the literal "none" opt-out', () => {
    const enforcement = decideEmitBinding({
      partId: "json-render:p1",
      sourceToolCallId: "none",
      alreadyRejected: false,
      toolInvocations: [
        mcpInvocation(
          "functions.mcp_twenty--crm_execute_tool:15",
          "twenty-crm",
          "execute_tool",
        ),
      ],
    });
    expect(enforcement).toMatchObject({
      decision: "accept",
      reason: "explicit_none",
      candidateCount: 1,
    });
  });

  it("accepts a re-emit still unbound after a prior rejection (loop guard)", () => {
    const enforcement = decideEmitBinding({
      partId: "json-render:p1",
      sourceToolCallId: undefined,
      alreadyRejected: true,
      toolInvocations: [
        mcpInvocation(
          "functions.mcp_twenty--crm_execute_tool:15",
          "twenty-crm",
          "execute_tool",
        ),
      ],
    });
    expect(enforcement).toMatchObject({
      decision: "accept",
      reason: "post_rejection",
      candidateCount: 1,
    });
  });

  it("rejects an unbound emit with candidates: no part, error-shaped result, and a warn log", async () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const logs: EmitBindingLogEntry[] = [];
    const tool = wrapEmitToolWithBindingFeedback(
      buildEmitJsonRenderUiTool(),
      () => [
        mcpInvocation(
          "functions.mcp_twenty--crm_execute_tool:15",
          "twenty-crm",
          "execute_tool",
        ),
      ],
      { log: (entry) => logs.push(entry) },
    );

    const result = await tool.execute("call-1", {
      id: "json-render:stable",
      spec: fixture.data.spec,
      mobileFallback: fixture.data.mobileFallback,
      durableActions: fixture.data.durableActions,
    });

    // Rejected: the model sees the correction and the loop can extract NO part
    // (so no state_snapshot / ui_message_chunk / binding side effects fire).
    expect(textOf(result)).toContain("was NOT accepted");
    expect(textOf(result)).toContain(
      "functions.mcp_twenty--crm_execute_tool:15",
    );
    expect(partOf(result)).toBeNull();
    expect((result as { details?: { ok?: boolean } }).details?.ok).toBe(false);
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: "json_render_unbound_emit",
        reason: "rejected",
        partId: "json-render:stable",
        candidateCount: 1,
      }),
    );
  });

  it("re-emit with the source id succeeds and captures a binding", async () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const registry: CanvasBindingSourceInvocation[] = [
      mcpInvocation(
        "functions.mcp_twenty--crm_execute_tool:15",
        "twenty-crm",
        "execute_tool",
      ),
    ];
    const tool = wrapEmitToolWithBindingFeedback(
      buildEmitJsonRenderUiTool(),
      () => registry,
    );

    // First emit: no sourceToolCallId → REJECTED (no part reaches the loop).
    const first = await tool.execute("call-1", {
      id: "json-render:stable",
      spec: fixture.data.spec,
      mobileFallback: fixture.data.mobileFallback,
      durableActions: fixture.data.durableActions,
    });
    expect(textOf(first)).toContain("was NOT accepted");
    expect(partOf(first)).toBeNull();

    // Second emit: SAME part id WITH the source id → accepted + confirmed.
    const second = await tool.execute("call-2", {
      id: "json-render:stable",
      sourceToolCallId: "functions.mcp_twenty--crm_execute_tool:15",
      spec: fixture.data.spec,
      mobileFallback: fixture.data.mobileFallback,
      durableActions: fixture.data.durableActions,
    });
    expect(textOf(second)).toContain(
      "Data-source binding recorded: twenty-crm/execute_tool.",
    );
    expect(partOf(second)).not.toBeNull();
  });

  it("re-emit still unbound is ACCEPTED once (loop guard: at most one rejection per part id)", async () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const logs: EmitBindingLogEntry[] = [];
    const tool = wrapEmitToolWithBindingFeedback(
      buildEmitJsonRenderUiTool(),
      () => [
        mcpInvocation(
          "functions.mcp_twenty--crm_execute_tool:15",
          "twenty-crm",
          "execute_tool",
        ),
      ],
      { log: (entry) => logs.push(entry) },
    );

    const args = {
      id: "json-render:stable",
      spec: fixture.data.spec,
      mobileFallback: fixture.data.mobileFallback,
      durableActions: fixture.data.durableActions,
    };
    const first = await tool.execute("call-1", args);
    expect(partOf(first)).toBeNull(); // rejected once

    // Same still-unbound part id again → accepted so the UI is never lost.
    const second = await tool.execute("call-2", args);
    expect(partOf(second)).not.toBeNull();
    expect(logs.filter((l) => l.reason === "rejected")).toHaveLength(1);
    expect(logs).toContainEqual(
      expect.objectContaining({
        reason: "post_rejection",
        partId: "json-render:stable",
      }),
    );
  });

  it('accepts an unbound emit tagged "none" without rejecting (warn reason=explicit_none)', async () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const logs: EmitBindingLogEntry[] = [];
    const tool = wrapEmitToolWithBindingFeedback(
      buildEmitJsonRenderUiTool(),
      () => [
        mcpInvocation(
          "functions.mcp_twenty--crm_execute_tool:15",
          "twenty-crm",
          "execute_tool",
        ),
      ],
      { log: (entry) => logs.push(entry) },
    );

    const result = await tool.execute("call-1", {
      id: "json-render:stable",
      sourceToolCallId: "none",
      spec: fixture.data.spec,
      mobileFallback: fixture.data.mobileFallback,
      durableActions: fixture.data.durableActions,
    });
    expect(partOf(result)).not.toBeNull(); // accepted, part flows to the loop
    expect(textOf(result)).not.toContain("was NOT accepted");
    expect(logs).toContainEqual(
      expect.objectContaining({
        reason: "explicit_none",
        partId: "json-render:stable",
      }),
    );
  });

  it("does not enforce when no candidate tool calls exist (static UI turns)", async () => {
    const fixture = createTaskReviewJsonRenderFixture();
    const logs: EmitBindingLogEntry[] = [];
    const tool = wrapEmitToolWithBindingFeedback(
      buildEmitJsonRenderUiTool(),
      () => [{ id: "functions.bash:1", status: "ok", result: {} }],
      { log: (entry) => logs.push(entry) },
    );
    const result = await tool.execute("call-1", {
      id: "json-render:stable",
      spec: fixture.data.spec,
      mobileFallback: fixture.data.mobileFallback,
      durableActions: fixture.data.durableActions,
    });
    expect(partOf(result)).not.toBeNull();
    expect(textOf(result)).not.toContain("was NOT accepted");
    expect(logs).toHaveLength(0);
  });

  it("passes a validator-rejected emit through untouched (no enforcement pollution)", async () => {
    const tool = wrapEmitToolWithBindingFeedback(
      buildEmitJsonRenderUiTool(),
      () => [
        mcpInvocation(
          "functions.mcp_twenty--crm_execute_tool:15",
          "twenty-crm",
          "execute_tool",
        ),
      ],
    );
    const result = await tool.execute("call-x", {
      spec: { not: "a valid spec" },
      mobileFallback: { title: "t", summary: "s" },
    });
    expect(textOf(result)).toContain(
      "rejected by the ThinkWork json-render validator",
    );
    expect(textOf(result)).not.toContain("was NOT accepted");
  });
});

function readJsonFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../../docs/fixtures/thread-json-render", name),
      "utf8",
    ),
  );
}

function readMarkdownFixture(name: string): string {
  return readFileSync(
    resolve(process.cwd(), "../../docs/fixtures/thread-json-render", name),
    "utf8",
  );
}
