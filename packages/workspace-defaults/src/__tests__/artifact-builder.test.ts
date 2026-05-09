import { describe, expect, it } from "vitest";
import { loadDefaults } from "../index.js";

const defaults = loadDefaults();
const skill = defaults["skills/artifact-builder/SKILL.md"];
const crmRecipe =
  defaults["skills/artifact-builder/references/crm-dashboard.md"];

describe("Artifact Builder defaults", () => {
  it("routes CRM dashboard prompts to the CRM dashboard recipe", () => {
    expect(skill).toContain("references/crm-dashboard.md");
    expect(skill).toContain("CRM pipeline");
    expect(skill).toContain("save_app");
    expect(skill).toContain("/artifacts/{appId}");
  });

  it("defines the CRM dashboard applet contract", () => {
    expect(crmRecipe).toContain("interface CrmDashboardData");
    expect(crmRecipe).toContain("sourceStatuses");
    expect(crmRecipe).toContain("stageExposure");
    expect(crmRecipe).toContain("staleActivity");
    expect(crmRecipe).toContain("topRisks");
    expect(crmRecipe).toContain("export async function refresh()");
    expect(crmRecipe).toContain("save_app");
    expect(crmRecipe).toContain("/artifacts/{appId}");
  });
});
