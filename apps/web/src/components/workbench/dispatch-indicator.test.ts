/**
 * THINK-136 U6 pure-logic tests (R6/R7, AE5 client half): id-based turn→message
 * pairing wins over the legacy timestamp heuristic, and the per-message
 * dispatch-indicator state derives correctly from the linked turn + metadata.
 */

import { describe, it, expect } from "vitest";
import {
  deriveDispatchIndicatorState,
  TIMED_OUT_FAILURE_COPY,
} from "./dispatch-indicator";
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
    ).toEqual({ state: "none", failureReason: null, failureKind: null });
  });

  it("returns none for a plain user message with no turn and no dispatch stamp", () => {
    expect(deriveDispatchIndicatorState(userMessage("m1", ""))).toEqual({
      state: "none",
      failureReason: null,
      failureKind: null,
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
    ).toEqual({
      state: "failed",
      failureReason: "boom",
      failureKind: "dispatch",
    });
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
      failureKind: "dispatch",
    });
  });

  it("parses an AWSJSON string metadata payload", () => {
    const message = userMessage("m1", "", {
      metadata: JSON.stringify({ dispatch: { status: "pending", attempt: 2 } }),
    });
    expect(deriveDispatchIndicatorState(message).state).toBe("pending");
  });

  // THINK-301 U6 (parent R9/R10/KTD4): timed_out splits on server-derived
  // recoveryPending — recovering renders benign, exhausted renders plain
  // status-keyed copy, and turn.error never reaches the derivation output.
  it("derives recovering for timed_out with recoveryPending true (AE1)", () => {
    expect(
      deriveDispatchIndicatorState(
        userMessage("m1", ""),
        turn("t", "", {
          status: "timed_out",
          error: "Stall detected: no activity for 5 minutes",
          recoveryPending: true,
        }),
      ),
    ).toEqual({ state: "recovering", failureReason: null, failureKind: null });
  });

  it("derives plain-copy failed for timed_out without recovery pending (AE2)", () => {
    // Q1-resolved copy, asserted verbatim: rendered with no prefix.
    expect(TIMED_OUT_FAILURE_COPY).toBe(
      "This response took too long to complete.",
    );
    for (const recoveryPending of [false, undefined, null]) {
      const derivation = deriveDispatchIndicatorState(
        userMessage("m1", ""),
        turn("t", "", {
          status: "timed_out",
          error: "Stall detected: no activity for 5 minutes",
          recoveryPending,
        }),
      );
      expect(derivation).toEqual({
        state: "failed",
        failureReason: TIMED_OUT_FAILURE_COPY,
        failureKind: "timed_out",
      });
      expect(JSON.stringify(derivation)).not.toContain("Stall detected");
    }
  });

  it("keeps the existing turn.error reason chain for non-stall failed turns even when recoveryPending is set (AE5)", () => {
    expect(
      deriveDispatchIndicatorState(
        userMessage("m1", ""),
        turn("t", "", {
          status: "failed",
          error: "boom",
          recoveryPending: true,
        }),
      ),
    ).toEqual({
      state: "failed",
      failureReason: "boom",
      failureKind: "dispatch",
    });
  });

  it("keeps cancelled excluded from failure treatment (R8)", () => {
    expect(
      deriveDispatchIndicatorState(
        userMessage("m1", ""),
        turn("t", "", { status: "cancelled", error: "stopped" }),
      ).state,
    ).toBe("none");
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
