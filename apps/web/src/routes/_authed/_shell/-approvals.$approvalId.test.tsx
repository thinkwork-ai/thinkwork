/**
 * Approvals route wiring (THINK-280 U6): the approval detail route renders
 * RoutineProposalReview for proposal-linked ids and keeps the
 * computer_approval path byte-identical, and both approvals surfaces list
 * pending Routine promotions.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("approvals route wiring for Routine proposals", () => {
  it("routes proposal-marked inbox items and direct proposal ids to the review panel", () => {
    const route = source("src/routes/_authed/_shell/approvals.$approvalId.tsx");
    // Inbox items stamped entity_type=capability_routine_proposal.
    expect(route).toContain("routineProposalIdOf");
    expect(route).toContain("RoutineProposalReview");
    // Direct-id fallback: submitted proposals have no inbox row yet, so the
    // route probes the id as a proposal when no inbox item matches.
    expect(route).toContain("RoutineProposalQuery");
    expect(route).toContain("pause: fetching || data?.inboxItem != null");
    // Pending promotions are listed alongside the computer-approval queue.
    expect(route).toContain("RoutineProposalQueue");
    // The computer_approval path is unchanged.
    expect(route).toContain('data?.inboxItem?.type === "computer_approval"');
    expect(route).toContain("ApprovalDetail");
  });

  it("lists pending Routine promotions on the approvals index", () => {
    const route = source("src/routes/_authed/_shell/approvals.index.tsx");
    expect(route).toContain("RoutineProposalQueue");
    expect(route).toContain("ApprovalQueue");
  });
});
