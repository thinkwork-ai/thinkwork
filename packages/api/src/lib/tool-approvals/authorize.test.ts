/**
 * Tool-approval authorization tests (THINK-302 U11 — R33, KTD-13).
 * Fail-closed classification + resolution matrix.
 */

import { describe, expect, it } from "vitest";
import {
  authorizeToolApprovalResolution,
  classifyApproval,
} from "./authorize.js";

const REQUESTER = "user-req";
const OPERATOR = { userId: "user-op", isTenantOperator: true };
const OTHER = { userId: "user-other", isTenantOperator: false };
const REQ_RESOLVER = { userId: REQUESTER, isTenantOperator: false };

describe("classifyApproval", () => {
  it("elevated when approval: always", () => {
    expect(classifyApproval({ approval: "always", class: "skill" })).toBe(
      "elevated",
    );
  });

  it("elevated for mcp/connection with a non-read operation", () => {
    expect(classifyApproval({ class: "mcp", hasNonReadOperation: true })).toBe(
      "elevated",
    );
    expect(
      classifyApproval({ class: "connection", hasNonReadOperation: true }),
    ).toBe("elevated");
  });

  it("elevated for an mcp/connection grant at space or user scope", () => {
    expect(classifyApproval({ class: "mcp", sourceScope: "space:s1" })).toBe(
      "elevated",
    );
    expect(
      classifyApproval({ class: "connection", sourceScope: "user:u1" }),
    ).toBe("elevated");
  });

  it("standard for approval: once on a read-only skill/tool", () => {
    expect(classifyApproval({ approval: "once", class: "skill" })).toBe(
      "standard",
    );
    expect(
      classifyApproval({
        approval: "once",
        class: "tool",
        hasNonReadOperation: false,
      }),
    ).toBe("standard");
  });

  it("unclassifiable when the manifest entry is unresolved", () => {
    expect(classifyApproval({ unresolved: true })).toBe("unclassifiable");
  });
});

describe("authorizeToolApprovalResolution", () => {
  it("standard: requesting user may approve, others may not", () => {
    expect(
      authorizeToolApprovalResolution({
        action: "approve",
        tier: "standard",
        requestingUserId: REQUESTER,
        resolver: REQ_RESOLVER,
      }).authorized,
    ).toBe(true);
    expect(
      authorizeToolApprovalResolution({
        action: "approve",
        tier: "standard",
        requestingUserId: REQUESTER,
        resolver: OTHER,
      }).authorized,
    ).toBe(false);
  });

  it("standard: a tenant operator may approve on the user's behalf", () => {
    expect(
      authorizeToolApprovalResolution({
        action: "approve",
        tier: "standard",
        requestingUserId: REQUESTER,
        resolver: OPERATOR,
      }).authorized,
    ).toBe(true);
  });

  it("elevated: operator only, not the requesting user", () => {
    expect(
      authorizeToolApprovalResolution({
        action: "approve",
        tier: "elevated",
        requestingUserId: REQUESTER,
        resolver: REQ_RESOLVER,
      }).authorized,
    ).toBe(false);
    expect(
      authorizeToolApprovalResolution({
        action: "approve",
        tier: "elevated",
        requestingUserId: REQUESTER,
        resolver: OPERATOR,
      }).authorized,
    ).toBe(true);
  });

  it("unclassifiable: operator only for every action (fail-closed)", () => {
    for (const action of ["approve", "deny", "cancel"] as const) {
      expect(
        authorizeToolApprovalResolution({
          action,
          tier: "unclassifiable",
          requestingUserId: REQUESTER,
          resolver: REQ_RESOLVER,
        }).authorized,
      ).toBe(false);
      expect(
        authorizeToolApprovalResolution({
          action,
          tier: "unclassifiable",
          requestingUserId: REQUESTER,
          resolver: OPERATOR,
        }).authorized,
      ).toBe(true);
    }
  });

  it("R32 cancel: the requesting user may cancel even an elevated approval", () => {
    expect(
      authorizeToolApprovalResolution({
        action: "cancel",
        tier: "elevated",
        requestingUserId: REQUESTER,
        resolver: REQ_RESOLVER,
      }).authorized,
    ).toBe(true);
    // …but a random other user cannot.
    expect(
      authorizeToolApprovalResolution({
        action: "cancel",
        tier: "elevated",
        requestingUserId: REQUESTER,
        resolver: OTHER,
      }).authorized,
    ).toBe(false);
  });

  it("space admin resolves standard only when opted in, never elevated", () => {
    const spaceAdmin = {
      userId: "user-sa",
      isTenantOperator: false,
      isSpaceAdmin: true,
    };
    expect(
      authorizeToolApprovalResolution({
        action: "approve",
        tier: "standard",
        requestingUserId: REQUESTER,
        resolver: spaceAdmin,
        allowSpaceAdminStandard: true,
      }).authorized,
    ).toBe(true);
    expect(
      authorizeToolApprovalResolution({
        action: "approve",
        tier: "standard",
        requestingUserId: REQUESTER,
        resolver: spaceAdmin,
        allowSpaceAdminStandard: false,
      }).authorized,
    ).toBe(false);
    expect(
      authorizeToolApprovalResolution({
        action: "approve",
        tier: "elevated",
        requestingUserId: REQUESTER,
        resolver: spaceAdmin,
        allowSpaceAdminStandard: true,
      }).authorized,
    ).toBe(false);
  });

  it("a wakeup turn with no requesting user still lets an operator resolve", () => {
    expect(
      authorizeToolApprovalResolution({
        action: "approve",
        tier: "standard",
        requestingUserId: null,
        resolver: OPERATOR,
      }).authorized,
    ).toBe(true);
    // …and nobody inherits the requester slot.
    expect(
      authorizeToolApprovalResolution({
        action: "cancel",
        tier: "standard",
        requestingUserId: null,
        resolver: OTHER,
      }).authorized,
    ).toBe(false);
  });
});
