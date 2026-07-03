/**
 * THINK-136 U6 pure-logic tests (R6/R7, AE5 client half): id-based turn→message
 * pairing wins over the legacy timestamp heuristic, and the per-message
 * dispatch-indicator state derives correctly from the linked turn + metadata.
 */

import { describe, it, expect } from "vitest";
import { deriveDispatchIndicatorState } from "./dispatch-indicator";
import { mapTurnsToUserMessages } from "./TaskThreadView";
import type { TaskThreadMessage, TaskThreadTurn } from "./TaskThreadView";

function userMessage(
  id: string,
  createdAt: string,
  extra: Partial<TaskThreadMessage> = {},
): TaskThreadMessage {
  return { id, role: "USER", createdAt, ...extra };
}

function turn(
  id: string,
  startedAt: string,
  extra: Partial<TaskThreadTurn> = {},
): TaskThreadTurn {
  return { id, status: "completed", startedAt, ...extra };
}

describe("mapTurnsToUserMessages — id-based pairing (KTD3)", () => {
  it("prefers triggeringMessageId over timestamp causality", () => {
    const messages = [
      userMessage("m1", "2026-07-03T00:00:00.000Z"),
      userMessage("m2", "2026-07-03T00:00:05.000Z"),
    ];
    // The turn started BEFORE m2 (timestamp pairing would pin it to m1), but
    // its id link names m2 — the link must win.
    const turns = [
      turn("t1", "2026-07-03T00:00:02.000Z", { triggeringMessageId: "m2" }),
    ];

    const map = mapTurnsToUserMessages(messages, turns);

    expect(map.get("m2")?.id).toBe("t1");
    expect(map.has("m1")).toBe(false);
  });

  it("falls back to timestamp pairing for legacy turns (null link)", () => {
    const messages = [
      userMessage("m1", "2026-07-03T00:00:00.000Z"),
      userMessage("m2", "2026-07-03T00:00:10.000Z"),
    ];
    const turns = [
      // No triggeringMessageId → timestamp causal pairing: started after m2.
      turn("t1", "2026-07-03T00:00:12.000Z"),
    ];

    const map = mapTurnsToUserMessages(messages, turns);

    expect(map.get("m2")?.id).toBe("t1");
  });

  it("keeps an id link even when a legacy turn's timestamp targets the same message", () => {
    const messages = [
      userMessage("m1", "2026-07-03T00:00:00.000Z"),
      userMessage("m2", "2026-07-03T00:00:10.000Z"),
    ];
    const turns = [
      // Legacy turn whose timestamp would pair to m2 (nearest-preceding)…
      turn("legacy", "2026-07-03T00:00:11.000Z"),
      // …but m2 is claimed by an explicit id link — that must win and the
      // legacy turn never overwrites it.
      turn("linked", "2026-07-03T00:00:01.000Z", {
        triggeringMessageId: "m2",
      }),
    ];

    const map = mapTurnsToUserMessages(messages, turns);

    expect(map.get("m2")?.id).toBe("linked");
    // m1 keeps its own linked-turn-free legacy pairing: the earlier legacy turn
    // had no preceding message other than the id-claimed m2, so it does not
    // mis-attribute to m1.
    expect(map.has("m1")).toBe(false);
  });

  it("id-linked and legacy turns coexist on distinct messages", () => {
    const messages = [
      userMessage("m1", "2026-07-03T00:00:00.000Z"),
      userMessage("m2", "2026-07-03T00:00:10.000Z"),
    ];
    const turns = [
      turn("legacy", "2026-07-03T00:00:02.000Z"), // timestamp-pairs to m1
      turn("linked", "2026-07-03T00:00:01.000Z", {
        triggeringMessageId: "m2",
      }),
    ];

    const map = mapTurnsToUserMessages(messages, turns);

    expect(map.get("m1")?.id).toBe("legacy");
    expect(map.get("m2")?.id).toBe("linked");
  });
});

describe("deriveDispatchIndicatorState", () => {
  it("returns none for a non-user message", () => {
    expect(
      deriveDispatchIndicatorState({ role: "ASSISTANT" }, undefined),
    ).toEqual({ state: "none", failureReason: null });
  });

  it("returns none for a plain user message with no turn and no dispatch stamp", () => {
    expect(deriveDispatchIndicatorState(userMessage("m1", ""))).toEqual({
      state: "none",
      failureReason: null,
    });
  });

  it("derives running / completed / failed from the linked turn status", () => {
    const message = userMessage("m1", "");
    expect(
      deriveDispatchIndicatorState(
        message,
        turn("t", "", { status: "running" }),
      ).state,
    ).toBe("running");
    expect(
      deriveDispatchIndicatorState(
        message,
        turn("t", "", { status: "completed" }),
      ).state,
    ).toBe("completed");
    expect(
      deriveDispatchIndicatorState(
        message,
        turn("t", "", { status: "failed", error: "boom" }),
      ),
    ).toEqual({ state: "failed", failureReason: "boom" });
  });

  it("derives failed from a synchronous metadata stamp when there is no turn", () => {
    const message = userMessage("m1", "", {
      metadata: {
        dispatch: {
          status: "failed",
          reason: "default dispatch error: invoke rejected",
          attempt: 1,
          route: "default",
        },
      },
    });
    expect(deriveDispatchIndicatorState(message)).toEqual({
      state: "failed",
      failureReason: "default dispatch error: invoke rejected",
    });
  });

  it("parses an AWSJSON string metadata payload", () => {
    const message = userMessage("m1", "", {
      metadata: JSON.stringify({ dispatch: { status: "pending", attempt: 2 } }),
    });
    expect(deriveDispatchIndicatorState(message).state).toBe("pending");
  });

  it("lets the linked turn status win over a pending metadata stamp", () => {
    const message = userMessage("m1", "", {
      metadata: { dispatch: { status: "pending", attempt: 2 } },
    });
    expect(
      deriveDispatchIndicatorState(
        message,
        turn("t", "", { status: "running" }),
      ).state,
    ).toBe("running");
  });
});
