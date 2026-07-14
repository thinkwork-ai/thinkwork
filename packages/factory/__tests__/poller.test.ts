import { describe, expect, it } from "vitest";

import { renderLedgerComment, DEFAULT_LEDGER } from "../src/linear/ledger.js";
import {
  PollAbortedError,
  laneConflictMarker,
  pollTick,
} from "../src/linear/poller.js";
import { FakeGateway, makeIssue } from "./fake-gateway.js";

const TEAM = "THINK";

describe("candidate filter", () => {
  it("matches lane-labeled active issues, LFG issues, and Verification issues regardless of lane", async () => {
    const gateway = new FakeGateway([
      makeIssue({
        identifier: "T-1",
        state: "Ready to Work",
        labels: ["Claude"],
      }),
      makeIssue({
        identifier: "T-2",
        state: "In Progress",
        labels: ["Codex", "LFG"],
      }),
      // Verification is Claude-lane-owned regardless of lane label:
      makeIssue({
        identifier: "T-3",
        state: "Verification",
        labels: ["Codex"],
      }),
      // Verification with NO lane label still enrolls:
      makeIssue({ identifier: "T-4", state: "Review", labels: [] }),
      // Active state but no lane label → not a candidate:
      makeIssue({ identifier: "T-5", state: "Ready to Work", labels: ["LFG"] }),
      // Lane label but inactive state → not a candidate:
      makeIssue({ identifier: "T-6", state: "Backlog", labels: ["Claude"] }),
      // Done is TERMINAL (auto-compound disabled) → never enrolled, even with
      // a lane label + LFG. Keeping Done enrolled burned ~4 API requests per
      // Done issue per tick against the 2,500 req/hr key limit.
      makeIssue({
        identifier: "T-7",
        state: "Done",
        labels: ["Claude", "LFG"],
      }),
      // Lane label but Todo → BELOW the Brainstorming enrollment floor → not a
      // candidate. Todo is operator-owned ideation; the daemon ignores it.
      makeIssue({ identifier: "T-8", state: "Todo", labels: ["Claude"] }),
    ]);

    const result = await pollTick(gateway, TEAM);
    const ids = result.candidates.map((c) => c.issue.identifier).sort();
    // T-7 (Done + lane) is NOT a candidate: Done is terminal.
    // T-8 (Todo + lane) is NOT: Todo is below the enrollment floor.
    expect(ids).toEqual(["T-1", "T-2", "T-3", "T-4"]);

    const byId = Object.fromEntries(
      result.candidates.map((c) => [c.issue.identifier, c]),
    );
    expect(byId["T-1"].lane).toBe("Claude");
    expect(byId["T-2"].lane).toBe("Codex");
    expect(byId["T-2"].hasLfg).toBe(true);
    expect(byId["T-3"].isVerification).toBe(true);
    expect(byId["T-3"].lane).toBe("Codex");
    expect(byId["T-4"].isVerification).toBe(true);
    expect(byId["T-4"].lane).toBeNull();
    expect(result.laneConflicts).toEqual([]);
  });

  it("inherits LFG from the direct parent so sub-issues never stall the tree at review gates", async () => {
    const gateway = new FakeGateway([
      // Sub-issue of an LFG parent, no LFG label of its own (the plan phase
      // creates children without copying the label — live THINK-284 stalled
      // its LFG parent THINK-282 at Requirements Review):
      makeIssue({
        identifier: "T-1",
        state: "Requirements Review",
        labels: ["Claude"],
        parentLabels: ["LFG"],
      }),
      // Parent without LFG → child does NOT inherit:
      makeIssue({
        identifier: "T-2",
        state: "Plan Review",
        labels: ["Claude"],
        parentLabels: ["Codex"],
      }),
      // No parent at all → own labels decide:
      makeIssue({
        identifier: "T-3",
        state: "In Progress",
        labels: ["Claude"],
      }),
    ]);

    const result = await pollTick(gateway, TEAM);
    const byId = Object.fromEntries(
      result.candidates.map((c) => [c.issue.identifier, c]),
    );
    expect(byId["T-1"].hasLfg).toBe(true);
    expect(byId["T-2"].hasLfg).toBe(false);
    expect(byId["T-3"].hasLfg).toBe(false);
  });

  it("parses existing ledger comments and synthesizes for issues without one", async () => {
    const withLedger = makeIssue({
      identifier: "T-1",
      state: "In Progress",
      labels: ["Claude"],
      comments: [
        { id: "c-existing", body: "unrelated comment" },
        {
          id: "c-ledger",
          body: renderLedgerComment(
            "T-1",
            {
              phase: "implement",
              lane: "Claude",
              worker: { id: "pid-7", host: "mini" },
              attempt: 1,
              blocker: null,
              compounded: false,
            },
            "notes",
          ),
        },
      ],
    });
    const withoutLedger = makeIssue({
      identifier: "T-2",
      state: "Ready to Work",
      labels: ["Codex"],
    });
    const gateway = new FakeGateway([withLedger, withoutLedger]);

    const result = await pollTick(gateway, TEAM);
    const byId = Object.fromEntries(
      result.candidates.map((c) => [c.issue.identifier, c]),
    );

    expect(byId["T-1"].ledger.synthesized).toBe(false);
    expect(byId["T-1"].ledger.ledger.phase).toBe("implement");
    expect(byId["T-1"].ledgerCommentId).toBe("c-ledger");

    expect(byId["T-2"].ledger.synthesized).toBe(true);
    expect(byId["T-2"].ledger.ledger).toEqual(DEFAULT_LEDGER);
    expect(byId["T-2"].ledgerCommentId).toBeNull();
  });

  it("the NEWEST ledger comment is authoritative over an older one (hijack guard)", async () => {
    // An older comment (e.g. a human quote or stale copy) that parses as a
    // ledger must never shadow the newer daemon-authored ledger — an injected
    // `compounded: true` would permanently suppress the compound phase.
    const hijack = renderLedgerComment("T-1", {
      ...DEFAULT_LEDGER,
      compounded: true,
    });
    const real = renderLedgerComment("T-1", {
      ...DEFAULT_LEDGER,
      phase: "implement",
      lane: "Claude",
    });
    const gateway = new FakeGateway([
      makeIssue({
        identifier: "T-1",
        state: "In Progress",
        labels: ["Claude"],
        comments: [
          { id: "c-old-hijack", body: hijack },
          { id: "c-new-real", body: real },
        ],
      }),
    ]);

    const result = await pollTick(gateway, TEAM);
    const candidate = result.candidates[0];
    expect(candidate.ledgerCommentId).toBe("c-new-real");
    expect(candidate.ledger.ledger.compounded).toBe(false);
    expect(candidate.ledger.ledger.phase).toBe("implement");
  });

  it("a comment quoting the ledger marker mid-body is NOT the ledger", async () => {
    const gateway = new FakeGateway([
      makeIssue({
        identifier: "T-1",
        state: "In Progress",
        labels: ["Claude"],
        comments: [
          {
            id: "c-quote",
            body: "Worker note: I will update automation-ledger:T-1 when done.\ncompounded: true",
          },
        ],
      }),
    ]);
    const result = await pollTick(gateway, TEAM);
    const candidate = result.candidates[0];
    expect(candidate.ledgerCommentId).toBeNull();
    expect(candidate.ledger.synthesized).toBe(true);
  });

  it("surfaces blocker labels on candidates", async () => {
    const gateway = new FakeGateway([
      makeIssue({
        identifier: "T-1",
        state: "Ready to Work",
        labels: ["Claude", "Needs Credentials"],
      }),
    ]);
    const result = await pollTick(gateway, TEAM);
    expect(result.candidates[0].blockerLabels).toEqual(["Needs Credentials"]);
  });

  it("U4/KTD6: the Paused label reaches blockerLabels through the real filter", async () => {
    // The console's pause verb is only real if the poller's BLOCKER_LABELS
    // filter admits "Paused" — otherwise pause acks success while workers
    // keep launching.
    const gateway = new FakeGateway([
      makeIssue({
        identifier: "T-2",
        state: "In Progress",
        labels: ["Claude", "Paused"],
      }),
    ]);
    const result = await pollTick(gateway, TEAM);
    expect(result.candidates[0].blockerLabels).toContain("Paused");
  });
});

describe("lane conflict (AE2)", () => {
  it("both lane labels → no dispatch; Needs User + single comment; idempotent across polls", async () => {
    const gateway = new FakeGateway([
      makeIssue({
        identifier: "T-9",
        state: "Ready to Work",
        labels: ["Claude", "Codex"],
      }),
    ]);

    const first = await pollTick(gateway, TEAM);
    expect(first.candidates).toEqual([]); // never dispatchable
    expect(first.laneConflicts.map((c) => c.issue.identifier)).toEqual(["T-9"]);
    expect(first.remediated).toEqual(["T-9"]);

    expect(gateway.writesOf("addLabel")).toHaveLength(1);
    expect(gateway.writesOf("addLabel")[0].args[1]).toBe("Needs User");
    const conflictComments = gateway.issues[0].comments.filter((c) =>
      c.body.includes(laneConflictMarker("T-9")),
    );
    expect(conflictComments).toHaveLength(1);
    // Ledger records the blocker.
    const ledgerComments = gateway.issues[0].comments.filter((c) =>
      c.body.includes("automation-ledger:T-9"),
    );
    expect(ledgerComments).toHaveLength(1);
    expect(ledgerComments[0].body).toContain("blocker: Needs User");

    // Second and third polls: nothing new written.
    const second = await pollTick(gateway, TEAM);
    const third = await pollTick(gateway, TEAM);
    expect(second.remediated).toEqual([]);
    expect(third.remediated).toEqual([]);
    expect(gateway.writesOf("addLabel")).toHaveLength(1);
    expect(
      gateway.issues[0].comments.filter((c) =>
        c.body.includes(laneConflictMarker("T-9")),
      ),
    ).toHaveLength(1);
    expect(
      gateway.issues[0].comments.filter((c) =>
        c.body.includes("automation-ledger:T-9"),
      ),
    ).toHaveLength(1);
  });

  it("updates an existing ledger comment in place rather than creating a second one", async () => {
    const existing = renderLedgerComment(
      "T-9",
      { ...DEFAULT_LEDGER, phase: "implement", lane: "Claude" },
      "history",
    );
    const gateway = new FakeGateway([
      makeIssue({
        identifier: "T-9",
        state: "In Progress",
        labels: ["Claude", "Codex"],
        comments: [{ id: "c-ledger", body: existing }],
      }),
    ]);

    await pollTick(gateway, TEAM);
    const ledgerComments = gateway.issues[0].comments.filter((c) =>
      c.body.includes("automation-ledger:T-9"),
    );
    expect(ledgerComments).toHaveLength(1);
    expect(ledgerComments[0].id).toBe("c-ledger");
    expect(ledgerComments[0].body).toContain("blocker: Needs User");
    expect(ledgerComments[0].body).toContain("history"); // prose preserved
  });
});

describe("mid-poll API failure", () => {
  it("aborts the tick cleanly with no writes; next tick retries and succeeds", async () => {
    const conflicted = makeIssue({
      identifier: "T-1",
      state: "Ready to Work",
      labels: ["Claude", "Codex"],
    });
    const second = makeIssue({
      identifier: "T-2",
      state: "Verification",
      labels: [],
    });
    const gateway = new FakeGateway([conflicted, second]);

    // Fail the SECOND read (comments of T-2) — after T-1 was already read.
    gateway.failListCommentsFor = second.id;
    await expect(pollTick(gateway, TEAM)).rejects.toThrow(PollAbortedError);

    // No partial state: even the already-read conflict was not remediated.
    expect(gateway.writes).toEqual([]);
    expect(gateway.issues[0].labels).not.toContain("Needs User");

    // Next tick (fake auto-clears the failure) retries from scratch.
    const result = await pollTick(gateway, TEAM);
    expect(result.candidates.map((c) => c.issue.identifier)).toEqual(["T-2"]);
    expect(result.remediated).toEqual(["T-1"]);
    expect(gateway.issues[0].labels).toContain("Needs User");
  });

  it("aborts when the issue listing itself fails", async () => {
    const gateway = new FakeGateway([
      makeIssue({
        identifier: "T-1",
        state: "Ready to Work",
        labels: ["Claude"],
      }),
    ]);
    gateway.failNextListIssues = true;
    await expect(pollTick(gateway, TEAM)).rejects.toThrow(PollAbortedError);
    expect(gateway.writes).toEqual([]);
    const retry = await pollTick(gateway, TEAM);
    expect(retry.candidates).toHaveLength(1);
  });
});
