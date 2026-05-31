import { describe, expect, it } from "vitest";

import {
  FULL_ALL_CAPABILITIES,
  LOCAL_ALL_CAPABILITIES,
  dryRunResults,
} from "../../scripts/pi-harness-smoke";

describe("mobile Pi harness smoke matrix", () => {
  it("keeps the local all matrix broad enough for tool, skill, and MCP regressions", () => {
    expect(LOCAL_ALL_CAPABILITIES).toEqual([
      "plain",
      "workspace",
      "workspace_tools",
      "web_search",
      "mcp",
      "mcp_auth_failure",
      "bash",
      "skill",
      "image",
      "file",
      "handoff_local",
      "abort",
    ]);
  });

  it("adds managed AgentCore Pi and background handoff rows only to the full matrix", () => {
    expect(LOCAL_ALL_CAPABILITIES).not.toContain("agentcore_pi");
    expect(FULL_ALL_CAPABILITIES).toContain("agentcore_pi");
    expect(FULL_ALL_CAPABILITIES).toContain("handoff_managed");
    expect(FULL_ALL_CAPABILITIES).toContain("handoff_late_finalize");
    expect(FULL_ALL_CAPABILITIES).toContain("handoff_unsafe_checkpoint");
  });

  it("dry-runs every requested row with replayable thread identifiers", () => {
    const results = dryRunResults({
      capabilities: ["web_search", "skill", "agentcore_pi", "handoff_managed"],
    });

    expect(results).toMatchObject([
      {
        capability: "web_search",
        status: "SKIP",
        reason: "dry_run_matrix_only",
        threadIdentifier: "DRY-001",
      },
      {
        capability: "skill",
        status: "SKIP",
        reason: "dry_run_matrix_only",
        threadIdentifier: "DRY-002",
      },
      {
        capability: "agentcore_pi",
        status: "SKIP",
        reason: "dry_run_matrix_only",
        threadIdentifier: "DRY-003",
      },
      {
        capability: "handoff_managed",
        status: "SKIP",
        reason: "dry_run_matrix_only",
        threadIdentifier: "DRY-004",
        threadTurnId: "dry-run-turn-4",
      },
    ]);
  });
});
