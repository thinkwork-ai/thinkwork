import { describe, expect, it } from "vitest";
import {
  filterCatalogSkills,
  isRunbookCatalogSkill,
  type CatalogSkill,
} from "../skills-api";

function catalogSkill(slug: string, tags: string[]): CatalogSkill {
  return {
    slug,
    name: slug,
    description: `${slug} skill`,
    category: "custom",
    version: "1.0.0",
    author: "thinkwork",
    icon: "FileText",
    tags,
    requires_env: [],
  };
}

describe("skills api catalog helpers", () => {
  it("detects runbook-capable catalog skills by tag", () => {
    expect(
      isRunbookCatalogSkill(
        catalogSkill("crm-dashboard", ["computer-runbook"]),
      ),
    ).toBe(true);
    expect(isRunbookCatalogSkill(catalogSkill("docs", ["knowledge"]))).toBe(
      false,
    );
  });

  it("filters catalog skills to runbook starters when requested", () => {
    const skills = [
      catalogSkill("crm-dashboard", ["computer-runbook"]),
      catalogSkill("slack", ["integration"]),
      catalogSkill("research-dashboard", ["COMPUTER-RUNBOOK"]),
    ];

    expect(
      filterCatalogSkills(skills, "all").map((skill) => skill.slug),
    ).toEqual(["crm-dashboard", "slack", "research-dashboard"]);
    expect(
      filterCatalogSkills(skills, "runbooks").map((skill) => skill.slug),
    ).toEqual(["crm-dashboard", "research-dashboard"]);
  });
});
