import { describe, expect, it } from "vitest";
import {
  ACTIVE_SPACE_MARKER,
  WORKSPACE_ROUTING_MARKER,
  composeAgentsMdWithRouting,
  stripGeneratedAgentsMdSections,
} from "./agents-md-composer.js";

const BASELINE = `# AGENTS.md

Root routing.

## Routing

| Task | Go to | Read | Skills |
| ---- | ----- | ---- | ------ |
| Build board pack | workspaces/finance-analyst/ | CONTEXT.md | sheets |
`;

const ROUTING_INPUT = {
  baseline: BASELINE,
  spaces: [
    {
      name: "Board Pack",
      folderPath: "Spaces/board-pack/",
      accessMode: "public",
      isActive: true,
    },
    {
      name: "Legal Review",
      folderPath: "Spaces/legal-review/",
      accessMode: "private",
      isActive: false,
    },
  ],
  user: { name: "Eric", folderPath: "User/" },
  participants: [
    { name: "Alice", folderPath: "Users/alice/" },
    { name: "Eric", folderPath: "Users/eric/" },
  ],
  agentProfiles: [
    { name: "Researcher", routingGuidance: "Deep research tasks" },
    { name: "Writer", routingGuidance: null },
  ],
};

describe("stripGeneratedAgentsMdSections", () => {
  it("returns marker-free content unchanged", () => {
    expect(stripGeneratedAgentsMdSections(BASELINE)).toBe(BASELINE);
  });

  it("truncates at the routing marker and at the legacy active-space marker", () => {
    const withRouting = `${BASELINE}\n${WORKSPACE_ROUTING_MARKER}\n\n## Workspace Routing\n\n- old\n`;
    const withLegacy = `${BASELINE}\n${ACTIVE_SPACE_MARKER}\n\n## Active Space\n\n- old\n`;
    expect(stripGeneratedAgentsMdSections(withRouting)).toBe(
      `${BASELINE.trimEnd()}\n`,
    );
    expect(stripGeneratedAgentsMdSections(withLegacy)).toBe(
      `${BASELINE.trimEnd()}\n`,
    );
  });

  it("truncates at the earliest marker when both are present", () => {
    const both = `${BASELINE}\n${ACTIVE_SPACE_MARKER}\n\nold\n\n${WORKSPACE_ROUTING_MARKER}\n\nolder\n`;
    const stripped = stripGeneratedAgentsMdSections(both);
    expect(stripped).not.toContain(ACTIVE_SPACE_MARKER);
    expect(stripped).not.toContain(WORKSPACE_ROUTING_MARKER);
    expect(stripped).toBe(`${BASELINE.trimEnd()}\n`);
  });

  it("returns empty content when the document is only a generated section", () => {
    expect(
      stripGeneratedAgentsMdSections(`${WORKSPACE_ROUTING_MARKER}\n\n- x\n`),
    ).toBe("");
  });
});

describe("composeAgentsMdWithRouting", () => {
  it("renders the baseline prose before the marker-delimited routing section", () => {
    const composed = composeAgentsMdWithRouting(ROUTING_INPUT);
    const markerIndex = composed.indexOf(WORKSPACE_ROUTING_MARKER);
    expect(markerIndex).toBeGreaterThan(0);
    expect(composed.slice(0, markerIndex)).toContain("Root routing.");
    expect(composed).toContain(
      "- Board Pack — `Spaces/board-pack/` (active, hydrated)",
    );
    expect(composed).toContain(
      "- Legal Review — `Spaces/legal-review/` (private; not currently hydrated)",
    );
    expect(composed).toContain("- Eric — `User/` (acting user, hydrated)");
    expect(composed).toContain("### Active Space Participants");
    // Participants carry their fetchable Users/<slug>/ path (NOT User/…) so
    // fetch_workspace_source mounts never collide with the acting user's
    // writable User/ tree.
    expect(composed).toContain(
      "- Alice — `Users/alice/` (not currently hydrated)",
    );
    expect(composed).toContain(
      "- Eric — `Users/eric/` (not currently hydrated)",
    );
    expect(composed).not.toContain("`User/alice/`");
    expect(composed).toContain("- Researcher — Deep research tasks");
    expect(composed).toContain("- Writer");
  });

  it("recomposes idempotently by truncating any prior generated section", () => {
    const once = composeAgentsMdWithRouting(ROUTING_INPUT);
    const twice = composeAgentsMdWithRouting({
      ...ROUTING_INPUT,
      baseline: once,
    });
    expect(twice).toBe(once);
    expect(twice.split(WORKSPACE_ROUTING_MARKER)).toHaveLength(2);
  });

  it("truncates a legacy active-space section from the baseline", () => {
    const legacyBaseline = `${BASELINE}\n${ACTIVE_SPACE_MARKER}\n\n## Active Space\n\nold\n`;
    const composed = composeAgentsMdWithRouting({
      ...ROUTING_INPUT,
      baseline: legacyBaseline,
    });
    expect(composed).not.toContain(ACTIVE_SPACE_MARKER);
    expect(composed).not.toContain("\n## Active Space\n");
    expect(composed).not.toContain("\nold\n");
  });

  it("omits user, participant, and profile entries when absent", () => {
    const composed = composeAgentsMdWithRouting({
      baseline: BASELINE,
      spaces: [ROUTING_INPUT.spaces[0]],
      user: null,
      participants: [],
      agentProfiles: [],
    });
    expect(composed).toContain("### Spaces");
    expect(composed).not.toContain("### User");
    expect(composed).not.toContain("### Active Space Participants");
    expect(composed).not.toContain("### Agent Profiles");
    expect(composed).not.toContain("not currently hydrated");
  });

  it("collapses multi-line routing guidance to keep the section deterministic", () => {
    const composed = composeAgentsMdWithRouting({
      ...ROUTING_INPUT,
      agentProfiles: [
        { name: "Researcher", routingGuidance: "Deep\n  research\ttasks " },
      ],
    });
    expect(composed).toContain("- Researcher — Deep research tasks");
  });

  it("renders a section-only document for an empty baseline", () => {
    const composed = composeAgentsMdWithRouting({
      ...ROUTING_INPUT,
      baseline: "",
    });
    expect(composed.startsWith(WORKSPACE_ROUTING_MARKER)).toBe(true);
  });
});
