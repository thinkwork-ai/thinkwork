import { describe, expect, it } from "vitest";

import { FULL_ALL_CAPABILITIES, dryRunResults } from "./pi-harness-smoke";

describe("pi-harness-smoke handoff matrix", () => {
  it("covers every background handoff acceptance scenario in the full dry-run matrix", () => {
    expect(FULL_ALL_CAPABILITIES).toEqual(
      expect.arrayContaining([
        "handoff_local",
        "handoff_managed",
        "handoff_late_finalize",
        "handoff_unsafe_checkpoint",
      ]),
    );
  });

  it("emits traceable thread and thread-turn identifiers for handoff dry runs", () => {
    const results = dryRunResults({
      capabilities: [
        "handoff_local",
        "handoff_managed",
        "handoff_late_finalize",
        "handoff_unsafe_checkpoint",
      ],
    });

    expect(results).toMatchObject([
      {
        capability: "handoff_local",
        threadId: "dry-run-thread-1",
        threadIdentifier: "DRY-001",
        threadTurnId: "dry-run-turn-1",
      },
      {
        capability: "handoff_managed",
        threadId: "dry-run-thread-2",
        threadIdentifier: "DRY-002",
        threadTurnId: "dry-run-turn-2",
      },
      {
        capability: "handoff_late_finalize",
        threadId: "dry-run-thread-3",
        threadIdentifier: "DRY-003",
        threadTurnId: "dry-run-turn-3",
      },
      {
        capability: "handoff_unsafe_checkpoint",
        threadId: "dry-run-thread-4",
        threadIdentifier: "DRY-004",
        threadTurnId: "dry-run-turn-4",
      },
    ]);
  });
});
