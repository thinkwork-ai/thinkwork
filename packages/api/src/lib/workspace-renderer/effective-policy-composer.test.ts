import { describe, expect, it } from "vitest";

import {
  composeWorkspacePolicy,
  isToolAllowed,
} from "./effective-policy-composer.js";

describe("composeWorkspacePolicy", () => {
  it("normalizes the agent blocked-tools list (THINK-302 U6: space policy retired)", () => {
    const policy = composeWorkspacePolicy({
      agentBlockedTools: ["send_email", "browser_automation", "send_email"],
    });

    // Deduplicated + sorted; no space contribution anymore.
    expect(policy.blockedTools).toEqual(["browser_automation", "send_email"]);
    expect(policy.diagnostics).not.toContain(
      "agent_and_space_blocked_tools_union_applied",
    );
  });

  it("keeps the agent allowlist and lets blocked tools win", () => {
    const policy = composeWorkspacePolicy({
      agentAllowedTools: ["query_context", "send_email"],
      agentBlockedTools: ["query_context"],
    });

    expect(policy.allowedTools).toEqual(["query_context", "send_email"]);
    expect(isToolAllowed(policy, "query_context")).toBe(false);
    expect(isToolAllowed(policy, "send_email")).toBe(true);
    expect(policy.diagnostics).toContain(
      "blocked_tools_take_precedence_over_allowed_tools",
    );
  });

  it("MCP allow/block policy is always empty (space mcp_policy retired)", () => {
    const policy = composeWorkspacePolicy({
      agentBlockedTools: ["send_email"],
    });

    expect(policy.mcpAllowedServers).toBeNull();
    expect(policy.mcpBlockedServers).toEqual([]);
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
