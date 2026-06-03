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

function turnWith(events: TaskThreadTurn["events"]): TaskThreadTurn {
  return {
    id: "run-1",
    status: "running",
    invocationSource: "chat_message",
    runtimeType: "pi",
    startedAt: "2026-06-03T00:00:00.000Z",
    finishedAt: null,
    model: "m",
    usageJson: null,
    resultJson: null,
    error: null,
    errorCode: null,
    systemPrompt: null,
    events,
  } as unknown as TaskThreadTurn;
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
});
