import { describe, expect, it } from "vitest";

import {
  composeWorkspacePolicy,
  isToolAllowed,
} from "./effective-policy-composer.js";

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

  it("composes model routing by source precedence while preserving distinct matches", () => {
    const policy = composeWorkspacePolicy({
      modelRoutingSources: [
        {
          owner: "agent",
          sourcePath: "TOOLS.md",
          precedence: 10,
          routes: [
            {
              tool: "workspace_skill",
              match: { slug: "financial-analysis" },
              model: "haiku",
            },
            {
              tool: "web_search",
              match: {},
              model: "haiku",
            },
          ],
        },
        {
          owner: "space",
          sourcePath: "Spaces/board-pack/TOOLS.md",
          precedence: 20,
          routes: [
            {
              tool: "workspace_skill",
              match: { slug: "financial-analysis" },
              model: "sonnet",
              reason: "Board work needs better synthesis",
            },
          ],
          diagnostics: ["space_tools_md_checked"],
        },
        {
          owner: "user",
          sourcePath: "User/TOOLS.md",
          precedence: 40,
          routes: [
            {
              tool: "workspace_skill",
              match: { slug: "financial-analysis" },
              model: "opus",
            },
            {
              tool: "workspace_skill",
              match: { slug: "legal-review" },
              model: "sonnet",
            },
          ],
        },
      ],
    });

    expect(policy.modelRouting).toEqual([
      {
        tool: "web_search",
        match: {},
        model: "haiku",
        sourcePath: "TOOLS.md",
        sourceOwner: "agent",
        precedence: 10,
      },
      {
        tool: "workspace_skill",
        match: { slug: "financial-analysis" },
        model: "opus",
        sourcePath: "User/TOOLS.md",
        sourceOwner: "user",
        precedence: 40,
      },
      {
        tool: "workspace_skill",
        match: { slug: "legal-review" },
        model: "sonnet",
        sourcePath: "User/TOOLS.md",
        sourceOwner: "user",
        precedence: 40,
      },
    ]);
    expect(policy.diagnostics).toContain("space_tools_md_checked");
  });
});
