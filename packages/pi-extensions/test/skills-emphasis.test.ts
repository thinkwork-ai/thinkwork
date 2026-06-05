import { describe, expect, it } from "vitest";
import { formatWorkspaceSkills, type WorkspaceSkill } from "../src/skills.js";

const skill = (slug: string, description = ""): WorkspaceSkill => ({
  slug,
  name: slug,
  description,
  skillPath: `/workspace/skills/${slug}/SKILL.md`,
  content: "",
});

describe("formatWorkspaceSkills emphasis (plan 2026-06-04-004 U4 / R9)", () => {
  const skills = [skill("email", "Send email"), skill("crm-dashboard", "CRM")];

  it("renders no emphasis directive when nothing is pinned", () => {
    const out = formatWorkspaceSkills(skills);
    expect(out).not.toContain("explicitly invoked");
    expect(out).not.toContain("(pinned)");
  });

  it("marks pinned skills and appends a prioritize directive", () => {
    const out = formatWorkspaceSkills(skills, new Set(["crm-dashboard"]));
    expect(out).toContain("- crm-dashboard (pinned): CRM");
    expect(out).toContain("- email: Send email"); // not pinned → no marker
    expect(out).toContain(
      "explicitly invoked these skills for this turn: crm-dashboard",
    );
    expect(out).toContain("Your other skills remain available");
  });

  it("ignores emphasized slugs that are not in the skill list", () => {
    const out = formatWorkspaceSkills(skills, new Set(["not-present"]));
    expect(out).not.toContain("explicitly invoked");
    expect(out).not.toContain("(pinned)");
  });

  it("returns empty string for an empty skill list regardless of emphasis", () => {
    expect(formatWorkspaceSkills([], new Set(["x"]))).toBe("");
  });
});
