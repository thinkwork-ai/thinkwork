/**
 * Convergence tests for live activity streaming (plan 2026-06-03-001 R1/G3).
 *
 * The highest-likelihood UX bug: a tool shown as a LIVE event
 * (tool_invocation_started) while the turn runs, then ALSO present in the
 * finalized usage.tool_invocations, must collapse to ONE action row — no
 * duplicate, no flicker. actionRowsForTurn owns the name-based dedup.
 */

import { describe, it, expect } from "vitest";
import { actionRowsForTurn } from "./TaskThreadView";
import type { TaskThreadTurn } from "./TaskThreadView";

function turnWith(
  events: TaskThreadTurn["events"],
  status: TaskThreadTurn["status"] = "running",
): TaskThreadTurn {
  return {
    id: "run-1",
    status,
    invocationSource: "chat_message",
    runtimeType: "pi",
    startedAt: "2026-06-03T00:00:00.000Z",
    finishedAt: status === "running" ? null : "2026-06-03T00:00:05.000Z",
    model: "m",
    usageJson: null,
    resultJson: null,
    error: null,
    errorCode: null,
    systemPrompt: null,
    events,
  } as unknown as TaskThreadTurn;
}

function completedDetail(rows: ReturnType<typeof actionRowsForTurn>) {
  const row = rows.find((row) => row.title === "tool invocation completed");
  expect(row).toBeTruthy();
  expect(row?.detail).toBeTruthy();
  return row?.detail ?? "";
}

const liveStarted = {
  id: "run-1:0",
  eventType: "tool_invocation_started",
  level: null,
  payload: { tool_name: "web_search", status: "running" },
  createdAt: "2026-06-03T00:00:01.000Z",
};

describe("actionRowsForTurn — live/finalized convergence", () => {
  it("renders a live step while running (no usage yet)", () => {
    const rows = actionRowsForTurn(turnWith([liveStarted]), {});
    expect(rows).toHaveLength(1);
  });

  it("collapses the live step + finalized usage.tool_invocations to ONE row", () => {
    // Same tool present live AND in the finalized usage blob.
    const rows = actionRowsForTurn(turnWith([liveStarted]), {
      tool_invocations: [{ tool_name: "web_search", status: "ok" }],
    });
    // Dedup by tool name → exactly one row, not two.
    expect(rows).toHaveLength(1);
  });

  it("keeps distinct tools as separate rows", () => {
    const rows = actionRowsForTurn(
      turnWith([
        liveStarted,
        {
          id: "run-1:1",
          eventType: "tool_invocation_started",
          level: null,
          payload: { tool_name: "file_read", status: "running" },
          createdAt: "2026-06-03T00:00:02.000Z",
        },
      ]),
      {},
    );
    expect(rows).toHaveLength(2);
  });

  it("pretty-prints nested JSON strings from finalized tool previews", () => {
    const rows = actionRowsForTurn(turnWith([], "succeeded"), {
      tool_invocations: [
        {
          tool_name: "web_extract",
          input_preview: JSON.stringify({ url: "https://example.com/" }),
          output_preview: JSON.stringify({
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: true,
                  provider: "firecrawl",
                  markdown: "Example Domain",
                }),
              },
            ],
          }),
          status: "ok",
        },
      ],
    });
    const detail = completedDetail(rows);

    expect(rows.map((row) => row.title)).toEqual([
      "Using web extract",
      "tool invocation completed",
    ]);
    expect(rows[0].detail).toContain('"url": "https://example.com/"');
    expect(rows[0].detail).toContain('"ok": true');
    expect(detail).toContain('"url": "https://example.com/"');
    expect(detail).toContain('"ok": true');
    expect(detail).toContain('"provider": "firecrawl"');
    expect(detail).not.toContain('\\"ok\\"');
  });

  it("unescapes truncated JSON preview fragments", () => {
    const rows = actionRowsForTurn(turnWith([], "succeeded"), {
      tool_invocations: [
        {
          tool_name: "web_extract",
          output_preview:
            '{"content":[{"type":"text","text":"{\\"ok\\":true,\\"provider\\":\\"firecrawl\\",\\"url\\":\\"https://hindsight.vectorize.io/\\",\\"markdown\\":\\"[Skip to main content]\\n\\nHindsight is State-of-the-Art',
          status: "ok",
        },
      ],
    });
    const detail = completedDetail(rows);

    expect(detail).toContain('"ok":true');
    expect(detail).toContain('"provider":"firecrawl"');
    expect(detail).toContain("Hindsight is State-of-the-Art");
    expect(detail).not.toContain('\\"provider\\"');
    expect(detail).not.toContain("\\n\\nHindsight");
  });

  it("pretty-prints nested JSON strings from completed tool events", () => {
    const rows = actionRowsForTurn(
      turnWith([
        {
          id: "run-1:2",
          eventType: "tool_invocation_completed",
          level: null,
          payload: {
            id: "functions.web_extract:0",
            tool_name: "web_extract",
            output_preview: JSON.stringify({
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: true,
                    provider: "firecrawl",
                    markdown: "Example Domain",
                  }),
                },
              ],
            }),
            status: "ok",
          },
          createdAt: "2026-06-03T00:00:03.000Z",
        },
      ]),
      {},
    );

    expect(rows[0].detail).toContain("Output: {");
    expect(rows[0].detail).toContain('"text": {');
    expect(rows[0].detail).toContain('"ok": true');
    expect(rows[0].detail).not.toContain('\\"provider\\"');
  });

  it("unescapes escaped preview fragments from completed web search events", () => {
    const rows = actionRowsForTurn(
      turnWith([
        {
          id: "run-1:3",
          eventType: "tool_invocation_completed",
          level: null,
          payload: {
            id: "functions.web_search:3",
            tool_name: "web_search",
            output_preview:
              '{\\"content\\":[{\\"type\\":\\"text\\",\\"text\\":\\"{\\\\\\"ok\\\\\\":true,\\\\\\"provider\\\\\\":\\\\\\"exa\\\\\\",\\\\\\"query\\\\\\":\\\\\\"SpaceX Starship Raptor 3 test flight failure date May 2026\\\\\\",\\\\\\"result_count\\\\\\":5,\\\\\\"results\\\\\\":[{\\\\\\"title\\\\\\":\\\\\\"Starship flight test 12',
            status: "ok",
          },
          createdAt: "2026-06-03T00:00:04.000Z",
        },
      ]),
      {},
    );

    expect(rows[0].detail).toContain("Output: {");
    expect(rows[0].detail).toContain('"provider":"exa"');
    expect(rows[0].detail).toContain("SpaceX Starship Raptor 3");
    expect(rows[0].detail).not.toContain('\\"content\\"');
    expect(rows[0].detail).not.toContain('\\\\\\"provider');
  });

  it("surfaces model routing evidence from finalized tool invocations", () => {
    const rows = actionRowsForTurn(turnWith([], "succeeded"), {
      tool_invocations: [
        {
          tool_name: "workspace_skill",
          model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
          input_tokens: 1234,
          output_tokens: 56,
          cached_read_tokens: 20,
          model_routing_status: "succeeded",
          model_routing_rule_source: {
            scope: "user",
            path: "users/eric/TOOLS.md",
          },
          model_routing_match: {
            skill: "research",
          },
          output_preview: "done",
        },
      ],
    });

    expect(rows[0].detail).toContain("Model routing");
    expect(rows[0].detail).toContain("Model: claude-haiku-4-5-20251001");
    expect(rows[0].detail).toContain("Tokens: 1.2K in / 56 out");
    expect(rows[0].detail).toContain("(20 cached)");
    expect(rows[0].detail).toContain("Routing status: succeeded");
    expect(rows[0].detail).toContain('"scope": "user"');
    expect(rows[0].detail).toContain('"skill": "research"');
  });
});
