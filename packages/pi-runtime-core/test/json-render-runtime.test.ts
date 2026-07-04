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
  buildEmitBindingFeedback,
  buildEmitJsonRenderUiTool,
  extractEmitJsonRenderToolPart,
  listMcpBindingCandidates,
  normalizeRuntimeThreadJsonRenderInput,
  threadJsonRenderActivityEvent,
  threadJsonRenderStateSnapshotActivityEvent,
  wrapEmitToolWithBindingFeedback,
  type CanvasBindingSourceInvocation,
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

  it("confirms the binding when a valid sourceToolCallId is passed", () => {
    const feedback = buildEmitBindingFeedback({
      partId: "json-render:p1",
      sourceToolCallId: "functions.mcp_twenty--crm_execute_tool:15",
      toolInvocations: [
        mcpInvocation(
          "functions.mcp_twenty--crm_execute_tool:15",
          "twenty-crm",
          "execute_tool",
        ),
      ],
    });
    expect(feedback.bound).toBe(true);
    expect(feedback.text).toBe(
      "Data-source binding recorded: twenty-crm/execute_tool.",
    );
    expect(feedback.binding).not.toBeNull();
  });

  it("hands back the exact candidate ids when unbound with MCP candidates", () => {
    const feedback = buildEmitBindingFeedback({
      partId: "json-render:p1",
      sourceToolCallId: undefined,
      toolInvocations: [
        mcpInvocation(
          "functions.mcp_twenty--crm_execute_tool:15",
          "twenty-crm",
          "execute_tool",
        ),
        mcpInvocation("functions.mcp_github_search:3", "github", "search"),
      ],
    });
    expect(feedback.bound).toBe(false);
    expect(feedback.candidateCount).toBe(2);
    expect(feedback.text).toContain("No data-source binding was recorded.");
    expect(feedback.text).toContain("re-emit with the SAME id");
    expect(feedback.text).toContain(
      "functions.mcp_twenty--crm_execute_tool:15 — twenty-crm/execute_tool",
    );
    expect(feedback.text).toContain(
      "functions.mcp_github_search:3 — github/search",
    );
  });

  it("emits no nudge when no MCP invocations exist", () => {
    const feedback = buildEmitBindingFeedback({
      partId: "json-render:p1",
      sourceToolCallId: undefined,
      toolInvocations: [{ id: "functions.bash:1", status: "ok", result: {} }],
    });
    expect(feedback.bound).toBe(false);
    expect(feedback.candidateCount).toBe(0);
    expect(feedback.text).toBeNull();
  });

  it("re-emit with the source id produces a binding (two executes through the registry)", async () => {
    const fixture = createTaskReviewJsonRenderFixture();
    // The live per-turn registry the loop would own; shared across executes.
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

    // First emit: model forgot sourceToolCallId → result nudges with candidate.
    const first = await tool.execute("call-1", {
      id: "json-render:stable",
      spec: fixture.data.spec,
      mobileFallback: fixture.data.mobileFallback,
      durableActions: fixture.data.durableActions,
    });
    const firstText = (first as { content: { text: string }[] }).content
      .map((c) => c.text)
      .join("\n");
    expect(firstText).toContain("No data-source binding was recorded.");
    expect(firstText).toContain("functions.mcp_twenty--crm_execute_tool:15");

    // Second emit: re-emit SAME part id WITH the source id → confirmed binding.
    const second = await tool.execute("call-2", {
      id: "json-render:stable",
      sourceToolCallId: "functions.mcp_twenty--crm_execute_tool:15",
      spec: fixture.data.spec,
      mobileFallback: fixture.data.mobileFallback,
      durableActions: fixture.data.durableActions,
    });
    const secondText = (second as { content: { text: string }[] }).content
      .map((c) => c.text)
      .join("\n");
    expect(secondText).toContain(
      "Data-source binding recorded: twenty-crm/execute_tool.",
    );
  });

  it("passes a rejected emit through untouched (no feedback pollution)", async () => {
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
    const text = (result as { content: { text: string }[] }).content
      .map((c) => c.text)
      .join("\n");
    expect(text).toContain("rejected by the ThinkWork json-render validator");
    expect(text).not.toContain("No data-source binding was recorded.");
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
