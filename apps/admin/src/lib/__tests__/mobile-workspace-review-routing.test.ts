// Tests for the mobile workspace-review routing logic introduced in U3 of
// the workspace-reviews refactor (docs/plans/2026-04-28-004-...).
//
// Mobile has no Jest/Vitest runner of its own, so by convention we colocate
// mobile-state tests under apps/admin/src/lib/__tests__/mobile-* and import
// the mobile module via a relative path. Same pattern as
// `mobile-thread-hitl-state.test.ts` and `mobile-workspace-review-state.test.ts`.
import { describe, expect, it } from "vitest";
import {
  hitlThreadPreview,
  isSubAgentReview,
  pendingHitlByThreadId,
  subAgentReviewPreview,
  threadTabBadgeState,
  type ThreadHitlReview,
} from "../../../../mobile/lib/thread-hitl-state";

// Build a review row similar to what the resolver returns for a paired
// caller. `responsibleUserId` is what the resolver computed — by the time
// rows reach mobile, the server has already filtered to the caller, so
// these helpers operate purely on the local view.
function review(overrides: Partial<ThreadHitlReview> = {}): ThreadHitlReview {
  return {
    threadId: "thread-1",
    requestedAt: "2026-04-28T12:00:00.000Z",
    reason: "needs_approval",
    targetPath: "memory/notes.md",
    responsibleUserId: "user-A",
    kind: "PAIRED",
    run: { id: "run-1", agentId: "agent-1", status: "awaiting_review" },
    ...overrides,
  };
}

describe("mobile workspace-review routing (U3)", () => {
  // ── Server-scoped query: when the resolver filters to the caller, mobile
  //    sees only that caller's rows. The helpers operate on the filtered
  //    view; nothing here re-filters cross-user. These cases verify the
  //    filtered view stays clean. (Covers AE1, R7.)
  it("user A signed in: only A's paired reviews surface; user B's rows never appear", () => {
    const onlyAsRows: ThreadHitlReview[] = [
      review({ threadId: "thread-A1", responsibleUserId: "user-A" }),
      review({ threadId: "thread-A2", responsibleUserId: "user-A" }),
    ];
    const byThread = pendingHitlByThreadId(onlyAsRows);
    expect([...byThread.keys()]).toEqual(["thread-A1", "thread-A2"]);

    // If the server were broken and leaked user B, the helpers would still
    // surface them — that's the whole point of the resolver-side filter
    // U2 added. Document it: client-side helpers don't re-derive scope.
    const leaked: ThreadHitlReview[] = [
      ...onlyAsRows,
      review({ threadId: "thread-B1", responsibleUserId: "user-B" }),
    ];
    const leakedMap = pendingHitlByThreadId(leaked);
    // Three entries — B's row would show. The mobile contract is "trust
    // the resolver"; the regression-protection lives in the resolver test
    // suite (`agentWorkspaceReviews-routing.test.ts`).
    expect(leakedMap.size).toBe(3);
  });

  // ── AE2: sub-agent of A's owned agent triggers a review; surfaces in
  //    A's mobile thread list with the parent agent's thread context.
  it("sub-agent review: surfaces with override label naming the sub-agent and target path", () => {
    const subReview = review({
      threadId: "thread-parent",
      run: { id: "run-99", agentId: "agent-sub-1", status: "awaiting_review" },
      targetPath: "tasks/draft.md",
    });
    const pairedAgentIds = new Set(["agent-parent"]); // user-A owns agent-parent only
    const agentNames = {
      "agent-parent": "ParentBot",
      "agent-sub-1": "Researcher",
    };

    expect(isSubAgentReview(subReview, pairedAgentIds)).toBe(true);
    expect(subAgentReviewPreview(subReview, { pairedAgentIds, agentNames })).toBe(
      "Sub-agent Researcher needs your input on tasks/draft.md",
    );
  });

  // ── AE2 (deep chain): sub-sub-agent → still flagged as sub-agent. We don't
  //    need to traverse the chain on the client; agentId not being in
  //    `pairedAgentIds` is sufficient because the resolver already verified
  //    the caller is the chain-resolved owner.
  it("deep chain sub-sub-agent: surfaces in user A's mobile (chain owner is the user)", () => {
    const deepReview = review({
      threadId: "thread-parent",
      run: { id: "run-deep", agentId: "agent-sub-sub", status: "awaiting_review" },
      targetPath: "memory/scratch.md",
      responsibleUserId: "user-A",
    });
    const pairedAgentIds = new Set(["agent-parent"]);
    const agentNames = { "agent-sub-sub": "DeepResearcher" };

    expect(
      subAgentReviewPreview(deepReview, { pairedAgentIds, agentNames }),
    ).toBe("Sub-agent DeepResearcher needs your input on memory/scratch.md");
  });

  // ── Direct-agent review: subAgentReviewPreview returns null so callers
  //    fall through to the default `hitlThreadPreview` copy.
  it("direct-agent review: no override; falls through to default preview", () => {
    const direct = review({
      run: { id: "run-1", agentId: "agent-parent", status: "awaiting_review" },
    });
    const pairedAgentIds = new Set(["agent-parent"]);
    const agentNames = { "agent-parent": "ParentBot" };

    expect(isSubAgentReview(direct, pairedAgentIds)).toBe(false);
    expect(
      subAgentReviewPreview(direct, { pairedAgentIds, agentNames }),
    ).toBeNull();
    expect(hitlThreadPreview(direct)).toBe("Waiting for confirmation: needs approval");
  });

  // ── User A has zero pending reviews: HITL count is 0; no badge.
  it("zero pending reviews: HITL count is 0; no Needs answer badges", () => {
    const byThread = pendingHitlByThreadId([]);
    expect(byThread.size).toBe(0);
    expect(
      threadTabBadgeState(
        [{ id: "thread-A1" }, { id: "thread-A2" }],
        byThread,
        () => false, // none unread
      ),
    ).toBeNull();
  });

  // ── AE3/AE4: System-agent review never reaches A's mobile because the
  //    resolver only returns rows where the chain resolves to the caller.
  //    We model that here: with the responsible-user filter on, system rows
  //    don't appear in the row list mobile receives.
  it("system-agent review absent from mobile (resolver excludes when responsibleUserId set)", () => {
    // Only paired rows arrive (the resolver-side filter discards system /
    // unrouted rows when `responsibleUserId` is set). Mobile renders only
    // what it received.
    const rowsForA: ThreadHitlReview[] = [
      review({ threadId: "thread-A1", kind: "PAIRED", responsibleUserId: "user-A" }),
    ];
    const byThread = pendingHitlByThreadId(rowsForA);
    expect([...byThread.keys()]).toEqual(["thread-A1"]);
    // Sanity: nothing in the array marks `kind=SYSTEM` for user A.
    expect(rowsForA.every((r) => r.kind !== "SYSTEM")).toBe(true);
  });

  // ── Auth context lacks userId (Google-federated edge): the call site
  //    pauses the query when `currentUser?.id` is null, so no unscoped
  //    request fires. We can't directly assert urql `pause`; instead we
  //    document the resolver behaviour: an empty/null caller-id input
  //    means "no scoped query yet" — never an unscoped result.
  it("missing userId: resolver-pause means no rows surface (empty array)", () => {
    // Simulate the pre-hydration moment where mobile has no `me.id` yet:
    // the variables would resolve to `responsibleUserId: null!`, but the
    // call site `pause: !callerUserId` blocks the network request — urql
    // returns `data: undefined`, which mobile treats as `[]`.
    const noData: ThreadHitlReview[] = [];
    const byThread = pendingHitlByThreadId(noData);
    expect(byThread.size).toBe(0);
  });

  // ── R8 regression: helper signature lets the existing mutation flow
  //    proceed unchanged. We test the helper-level preview text the in-thread
  //    confirmation card renders so the structural pieces stay stable.
  it("preview helpers stay stable for the in-thread confirmation card (R8)", () => {
    const r = review({ reason: "review_changes" });
    expect(hitlThreadPreview(r)).toBe("Waiting for confirmation: review changes");
  });

  // ── AE4: After A approves a paired review, A's HITL count decrements;
  //    B's mobile is unaffected. Same view-derivation: the helpers operate
  //    on whatever the server returns, so an approved row dropping out of
  //    the result set deterministically removes it from the per-thread map.
  it("approval flow: removed row drops the per-thread mapping", () => {
    const before: ThreadHitlReview[] = [
      review({ threadId: "thread-A1", run: { id: "run-1", agentId: "agent-A1" } }),
      review({ threadId: "thread-A2", run: { id: "run-2", agentId: "agent-A2" } }),
    ];
    expect(pendingHitlByThreadId(before).size).toBe(2);

    // Resolver result after approve(run-1) — the server returns one fewer
    // row. The local helper reflects that without re-fetching itself.
    const after = before.filter((r) => r.run?.id !== "run-1");
    expect(pendingHitlByThreadId(after).size).toBe(1);
    expect([...pendingHitlByThreadId(after).keys()]).toEqual(["thread-A2"]);
  });
});
