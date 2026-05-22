import { describe, expect, it } from "vitest";
import { filterCatalogSkills, type CatalogSkill } from "../skills-api";

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
  it("passes catalog skills through when no filter is applied", () => {
    const skills = [
      catalogSkill("crm-dashboard", ["dashboard", "crm"]),
      catalogSkill("slack", ["integration"]),
    ];

    expect(
      filterCatalogSkills(skills, "all").map((skill) => skill.slug),
    ).toEqual(["crm-dashboard", "slack"]);
  });
});
