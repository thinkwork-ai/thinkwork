import { describe, expect, it } from "vitest";
import {
  parseFormFromMarkdown,
  renderAgentsMd,
  renderUserMd,
} from "../personalization-markdown";

describe("mobile personalization markdown helpers", () => {
  it("parses AGENTS.md identity, personality, style, and USER.md fields", () => {
    const form = parseFormFromMarkdown(
      [
        "# AGENTS.md",
        "",
        "## What This Is",
        "Keep me.",
        "",
        "## Personality",
        "Curious and direct.",
        "",
        "### Communication Style",
        "Casual",
        "",
        "## Identity",
        "- **Name:** Nova",
        "- **Creature:** fox",
        "",
      ].join("\n"),
      [
        "# User Context",
        "",
        "## Name",
        "Eric",
        "",
        "## Role",
        "Engineer",
        "",
        "## About",
        "Builds agents.",
        "",
        "## Topics of Interest",
        "Runtime systems",
        "",
        "## Things to Remember",
        "Prefers concise updates.",
        "",
        "## Timezone",
        "America/Chicago",
        "",
      ].join("\n"),
    );

    expect(form).toMatchObject({
      agentName: "Nova",
      personalityTraits: "Curious and direct.",
      communicationStyle: "casual",
      preferredName: "Eric",
      roleDescription: "Engineer",
      aboutMe: "Builds agents.",
      topicsOfInterest: "Runtime systems",
      thingsToRemember: "Prefers concise updates.",
      timezone: "America/Chicago",
    });
  });

  it("renders AGENTS.md without corrupting preceding sections or custom identity fields", () => {
    const existing = [
      "# AGENTS.md",
      "",
      "## What This Is",
      "Keep me.",
      "",
      "## Personality",
      "Old personality.",
      "",
      "## Identity",
      "- **Name:** Old Name",
      "- **Creature:** custom dragon",
      "- **Vibe:** sharp",
      "- **Emoji:** 🐉",
      "- **Avatar:** avatar://custom",
      "",
      "Agent-authored identity prose.",
      "",
      "## Platform Behavior",
      "Still here.",
      "",
    ].join("\n");

    const rendered = renderAgentsMd(existing, {
      agentName: "Nova",
      personalityTraits: "Curious and direct.",
      communicationStyle: "formal",
      preferredName: "",
      roleDescription: "",
      aboutMe: "",
      topicsOfInterest: "",
      thingsToRemember: "",
      timezone: "",
    });

    expect(rendered).toContain("## What This Is\nKeep me.");
    expect(rendered).toContain("## Personality\nCurious and direct.");
    expect(rendered).toContain("### Communication Style\nformal");
    expect(rendered).toContain("- **Name:** Nova");
    expect(rendered).toContain("- **Creature:** custom dragon");
    expect(rendered).toContain("- **Emoji:** 🐉");
    expect(rendered).toContain("Agent-authored identity prose.");
    expect(rendered).toContain("## Platform Behavior\nStill here.");
    expect(rendered).not.toContain("Old personality.");
    expect(rendered).not.toContain("Old Name");
  });

  it("inserts a missing identity name line without replacing the section body", () => {
    const rendered = renderAgentsMd(
      [
        "# AGENTS.md",
        "",
        "## Identity",
        "- **Creature:** custom dragon",
        "Custom body.",
        "",
      ].join("\n"),
      {
        agentName: "Nova",
        personalityTraits: "",
        communicationStyle: "balanced",
        preferredName: "",
        roleDescription: "",
        aboutMe: "",
        topicsOfInterest: "",
        thingsToRemember: "",
        timezone: "",
      },
    );

    expect(rendered).toContain(
      "## Identity\n- **Name:** Nova\n- **Creature:** custom dragon\nCustom body.",
    );
  });

  it("renders USER.md from form fields", () => {
    expect(
      renderUserMd({
        agentName: "",
        personalityTraits: "",
        communicationStyle: "balanced",
        preferredName: "Eric",
        roleDescription: "Engineer",
        aboutMe: "",
        topicsOfInterest: "AI",
        thingsToRemember: "",
        timezone: "America/Chicago",
      }),
    ).toContain("## Name\nEric");
  });
});
