import { describe, expect, it } from "vitest";
import { parseWorkspaceTarget } from "../lib/workspace-target.js";

const routes = ["expenses", "support/escalation", "a/b/c/d"];

describe("parseWorkspaceTarget", () => {
  it("accepts root target", () => {
    expect(parseWorkspaceTarget(".", [])).toEqual({
      valid: true,
      normalizedPath: "",
      depth: 0,
      reason: null,
    });
  });

  it("accepts routable single and nested targets", () => {
    expect(parseWorkspaceTarget("expenses", routes)).toMatchObject({
      valid: true,
      normalizedPath: "expenses",
      depth: 1,
    });
    expect(parseWorkspaceTarget("support/escalation", routes)).toMatchObject({
      valid: true,
      normalizedPath: "support/escalation",
      depth: 2,
    });
  });

  it("rejects traversal, absolute paths, and malformed syntax", () => {
    expect(parseWorkspaceTarget("../etc", routes)).toMatchObject({
      valid: false,
      reason: "traversal",
    });
    expect(parseWorkspaceTarget("/expenses", routes)).toMatchObject({
      valid: false,
      reason: "absolute",
    });
    expect(parseWorkspaceTarget("Expenses", routes)).toMatchObject({
      valid: false,
      reason: "malformed",
    });
    expect(parseWorkspaceTarget("expenses//audit", routes)).toMatchObject({
      valid: false,
      reason: "malformed",
    });
  });

  it("rejects reserved names at any depth", () => {
    expect(parseWorkspaceTarget("memory", ["memory"])).toMatchObject({
      valid: false,
      reason: "reserved_name",
    });
    expect(parseWorkspaceTarget("team/skills", ["team/skills"])).toMatchObject({
      valid: false,
      reason: "reserved_name",
    });
  });

  it("rejects targets over the v1 depth cap", () => {
    expect(parseWorkspaceTarget("a/b/c/d/e", ["a/b/c/d/e"])).toMatchObject({
      valid: false,
      depth: 5,
      reason: "depth_exceeded",
    });
  });

  it("rejects syntactically valid but unroutable targets", () => {
    expect(parseWorkspaceTarget("legal", routes)).toMatchObject({
      valid: false,
      reason: "not_routable",
    });
  });
});

