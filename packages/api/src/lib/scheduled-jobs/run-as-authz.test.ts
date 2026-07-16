/**
 * Run-as authorization tests (THINK-302 U7 — R28, KTD-14).
 */

import { describe, expect, it } from "vitest";
import {
  authorizeRunAsAssignment,
  revalidateRunAsAtDispatch,
} from "./run-as-authz.js";

const MEMBER = { userId: "u-member", isTenantOperator: false };
const OPERATOR = { userId: "u-op", isTenantOperator: true };
const activePublicTarget = {
  isActiveTenantMember: true,
  runInSpaceIsPrivate: false,
  isRunInSpaceMember: false,
};

describe("authorizeRunAsAssignment (save-time)", () => {
  it("clearing run-as is always allowed", () => {
    expect(
      authorizeRunAsAssignment({ runAsUserId: null, actor: MEMBER }).ok,
    ).toBe(true);
  });

  it("a member may set run-as to themself", () => {
    expect(
      authorizeRunAsAssignment({
        runAsUserId: MEMBER.userId,
        actor: MEMBER,
        target: activePublicTarget,
      }).ok,
    ).toBe(true);
  });

  it("a member may NOT set run-as to another user", () => {
    const result = authorizeRunAsAssignment({
      runAsUserId: "u-other",
      actor: MEMBER,
      target: activePublicTarget,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("tenant operator");
  });

  it("an operator may set run-as to another active member", () => {
    expect(
      authorizeRunAsAssignment({
        runAsUserId: "u-other",
        actor: OPERATOR,
        target: activePublicTarget,
      }).ok,
    ).toBe(true);
  });

  it("rejects a non-member / inactive target even for an operator", () => {
    const result = authorizeRunAsAssignment({
      runAsUserId: "u-other",
      actor: OPERATOR,
      target: { ...activePublicTarget, isActiveTenantMember: false },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("active member");
  });

  it("requires private-space membership when the run-in-space is private", () => {
    const denied = authorizeRunAsAssignment({
      runAsUserId: "u-other",
      actor: OPERATOR,
      target: {
        isActiveTenantMember: true,
        runInSpaceIsPrivate: true,
        isRunInSpaceMember: false,
      },
    });
    expect(denied.ok).toBe(false);
    const allowed = authorizeRunAsAssignment({
      runAsUserId: "u-other",
      actor: OPERATOR,
      target: {
        isActiveTenantMember: true,
        runInSpaceIsPrivate: true,
        isRunInSpaceMember: true,
      },
    });
    expect(allowed.ok).toBe(true);
  });

  it("fails closed when a non-null run-as has no resolved target facts", () => {
    const result = authorizeRunAsAssignment({
      runAsUserId: MEMBER.userId,
      actor: MEMBER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("unresolved");
  });
});

describe("revalidateRunAsAtDispatch", () => {
  it("keeps a still-valid run-as identity", () => {
    const decision = revalidateRunAsAtDispatch({
      runAsUserId: "u-x",
      target: activePublicTarget,
    });
    expect(decision).toEqual({ runAsUserId: "u-x", downgraded: false });
  });

  it("no run-as = root-only, not a downgrade", () => {
    expect(revalidateRunAsAtDispatch({ runAsUserId: null })).toEqual({
      runAsUserId: null,
      downgraded: false,
    });
  });

  it("deactivated user → drops to root-only with a warning (no substitution)", () => {
    const decision = revalidateRunAsAtDispatch({
      runAsUserId: "u-x",
      target: { ...activePublicTarget, isActiveTenantMember: false },
    });
    expect(decision.runAsUserId).toBeNull();
    expect(decision.downgraded).toBe(true);
    if (decision.runAsUserId === null && decision.downgraded) {
      expect(decision.reason).toContain("root-only");
    }
  });

  it("removed from a required private space → drops to root-only", () => {
    const decision = revalidateRunAsAtDispatch({
      runAsUserId: "u-x",
      target: {
        isActiveTenantMember: true,
        runInSpaceIsPrivate: true,
        isRunInSpaceMember: false,
      },
    });
    expect(decision.runAsUserId).toBeNull();
    expect(decision.downgraded).toBe(true);
  });

  it("unresolved target at dispatch → fails closed to root-only", () => {
    const decision = revalidateRunAsAtDispatch({ runAsUserId: "u-x" });
    expect(decision.runAsUserId).toBeNull();
    expect(decision.downgraded).toBe(true);
  });
});
