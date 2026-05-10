import { describe, expect, it } from "vitest";
import { loadDefaults } from "../index.js";

const defaults = loadDefaults();
const skill = defaults["skills/artifact-builder/SKILL.md"];
const crmRecipe =
  defaults["skills/artifact-builder/references/crm-dashboard.md"];

describe("Artifact Builder defaults", () => {
  it("routes CRM dashboard prompts to the CRM dashboard recipe", () => {
    expect(skill).toContain(
      "skills/artifact-builder/references/crm-dashboard.md",
    );
    expect(skill).toContain("Do not use `delegate` or `delegate_to_workspace`");
    expect(skill).toContain("CRM pipeline");
    expect(skill).toContain("save_app");
    expect(skill).toContain("/artifacts/{appId}");
    expect(skill).toContain("host-provided Artifact chrome");
    expect(skill).toContain("sandboxed iframe runtime");
    expect(skill).toContain("Your TSX should render only the app body");
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
    expect(crmRecipe).toContain("Render the dashboard body only");
    expect(crmRecipe).toContain("do not add a duplicate app shell");
    expect(crmRecipe).toContain("source coverage panel");
    expect(crmRecipe).toContain("unless the user explicitly requests it");
  });

  it("keeps host chrome and provenance guidance out of default app bodies", () => {
    expect(skill).toContain("Do not create an outer artifact card");
    expect(skill).toContain("source coverage, evidence, or provenance panel");
    expect(skill).not.toContain("Header with title, summary, and source badges");
    expect(crmRecipe).not.toContain("Header: title, summary");
  });
});
