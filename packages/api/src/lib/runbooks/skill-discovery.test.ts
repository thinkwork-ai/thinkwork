import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildComputerRunbookSkill } from "./skill-discovery.js";

const skillCatalogRoot = fileURLToPath(
  new URL("../../../../skill-catalog", import.meta.url),
);

describe("runbook skill discovery", () => {
  it("adapts a runbook-capable skill directory into the Computer runbook shape", async () => {
    const runbook = await buildComputerRunbookSkill({
      skillMdPath: "skills/crm-dashboard/SKILL.md",
      skillMd: readSkillFile("crm-dashboard", "SKILL.md"),
      readSkillFile: (relativePath) =>
        Promise.resolve(readSkillFile("crm-dashboard", relativePath)),
    });

    expect(runbook).toEqual(
      expect.objectContaining({
        slug: "crm-dashboard",
        catalog: expect.objectContaining({
          displayName: "CRM Dashboard",
        }),
        skill: expect.objectContaining({
          source: "template-workspace",
          contractPath: "references/thinkwork-runbook.json",
        }),
      }),
    );
    expect(runbook?.phases.find((phase) => phase.id === "produce")).toEqual(
      expect.objectContaining({
        guidanceMarkdown: expect.stringContaining("CrmDashboardData"),
      }),
    );
  });

  it("ignores ordinary skills without the Computer runbook marker", async () => {
    await expect(
      buildComputerRunbookSkill({
        skillMdPath: "skills/plain/SKILL.md",
        skillMd: [
          "---",
          "name: plain",
          "description: A plain workspace skill.",
          "---",
          "",
          "Do normal skill work.",
        ].join("\n"),
        readSkillFile: async () => {
          throw new Error("ordinary skills should not load references");
        },
      }),
    ).resolves.toBeNull();
  });

  it("rejects runbook contract paths outside the skill directory", async () => {
    await expect(
      buildComputerRunbookSkill({
        skillMdPath: "skills/bad/SKILL.md",
        skillMd: [
          "---",
          "name: bad",
          "description: Bad runbook skill.",
          "metadata:",
          "  thinkwork_kind: computer-runbook",
          "  thinkwork_runbook_contract: ../secrets.json",
          "---",
          "",
          "Bad instructions.",
        ].join("\n"),
        readSkillFile: async () => "{}",
      }),
    ).rejects.toMatchObject({
      issues: [expect.stringContaining("inside the skill")],
    });
  });

  it("requires the SKILL.md name to match the assigned workspace folder", async () => {
    await expect(
      buildComputerRunbookSkill({
        skillMdPath: "skills/not-crm/SKILL.md",
        skillMd: readSkillFile("crm-dashboard", "SKILL.md"),
        readSkillFile: (relativePath) =>
          Promise.resolve(readSkillFile("crm-dashboard", relativePath)),
      }),
    ).rejects.toMatchObject({
      issues: [
        expect.stringContaining('must match workspace skill folder "not-crm"'),
      ],
    });
  });
});

function readSkillFile(slug: string, relativePath: string) {
  return readFileSync(join(skillCatalogRoot, slug, relativePath), "utf8");
}
