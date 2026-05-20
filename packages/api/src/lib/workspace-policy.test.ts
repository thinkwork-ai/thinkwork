import { describe, expect, it } from "vitest";

import { composeWorkspacePolicy, isToolAllowed } from "./workspace-policy.js";

describe("composeWorkspacePolicy", () => {
  it("unions agent and Space blocked tools", () => {
    const policy = composeWorkspacePolicy({
      agentBlockedTools: ["send_email", "browser_automation"],
      spaceToolPolicy: {
        blockedTools: ["execute_code", "send_email"],
      },
    });

    expect(policy.blockedTools).toEqual([
      "browser_automation",
      "execute_code",
      "send_email",
    ]);
    expect(policy.diagnostics).toContain(
      "agent_and_space_blocked_tools_union_applied",
    );
  });

  it("intersects allowed tools and lets blocked tools win", () => {
    const policy = composeWorkspacePolicy({
      agentAllowedTools: ["query_context", "send_email"],
      spaceToolPolicy: {
        allowedTools: ["query_context", "execute_code"],
        blockedTools: ["query_context"],
      },
    });

    expect(policy.allowedTools).toEqual(["query_context"]);
    expect(isToolAllowed(policy, "query_context")).toBe(false);
    expect(isToolAllowed(policy, "send_email")).toBe(false);
    expect(policy.diagnostics).toContain(
      "blocked_tools_take_precedence_over_allowed_tools",
    );
  });

  it("normalizes MCP allow and block policy", () => {
    const policy = composeWorkspacePolicy({
      spaceMcpPolicy: {
        allowedServers: ["github", "github", " slack "],
        blockedServers: ["prod-db"],
      },
    });

    expect(policy.mcpAllowedServers).toEqual(["github", "slack"]);
    expect(policy.mcpBlockedServers).toEqual(["prod-db"]);
  });
});
