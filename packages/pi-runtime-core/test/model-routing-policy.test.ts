import { describe, expect, it } from "vitest";

import {
  ModelRoutingPolicyError,
  assertModelRouteApproved,
  findModelRoutingDecision,
  normalizeApprovedModelIds,
  normalizeModelRoutingPolicy,
} from "../src/model-routing-policy.js";

describe("model routing policy", () => {
  it("normalizes route arrays and de-duplicates approved models", () => {
    const policy = normalizeModelRoutingPolicy({
      routes: [
        {
          tool: "workspace_skill",
          match: { slug: "research" },
          model: "us.amazon.nova-micro-v1:0",
          sourcePath: "/workspace/TOOLS.md",
          sourceOwner: "user",
          precedence: 3,
        },
        { tool: "", model: "ignored" },
      ],
    });

    expect(policy.routes).toEqual([
      {
        tool: "workspace_skill",
        match: { slug: "research" },
        model: "us.amazon.nova-micro-v1:0",
        sourcePath: "/workspace/TOOLS.md",
        sourceOwner: "user",
        precedence: 3,
      },
    ]);
    expect(
      normalizeApprovedModelIds([
        " us.amazon.nova-micro-v1:0 ",
        "us.amazon.nova-micro-v1:0",
        "",
      ]),
    ).toEqual(["us.amazon.nova-micro-v1:0"]);
  });

  it("chooses the most specific matching route, then precedence", () => {
    const policy = normalizeModelRoutingPolicy([
      {
        tool: "workspace_skill",
        match: {},
        model: "generic",
        precedence: 100,
      },
      {
        tool: "workspace_skill",
        match: { slug: "research" },
        model: "space-model",
        precedence: 10,
      },
      {
        tool: "workspace_skill",
        match: { slug: "research" },
        model: "user-model",
        precedence: 20,
        sourceOwner: "user",
      },
    ]);

    const decision = findModelRoutingDecision(policy, {
      toolName: "workspace_skill",
      match: { slug: "research" },
    });

    expect(decision?.route.model).toBe("user-model");
    expect(decision?.ruleSource).toEqual({ owner: "user", precedence: 20 });
  });

  it("throws when a matched route requests an unapproved model", () => {
    const decision = findModelRoutingDecision(
      normalizeModelRoutingPolicy([
        {
          tool: "workspace_skill",
          match: { slug: "research" },
          model: "unapproved",
        },
      ]),
      { toolName: "workspace_skill", match: { slug: "research" } },
    );

    expect(decision).toBeTruthy();
    expect(() =>
      assertModelRouteApproved({
        decision: decision!,
        approvedModelIds: ["approved"],
      }),
    ).toThrow(ModelRoutingPolicyError);
  });
});
