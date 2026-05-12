import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RUNBOOK_SKILL_CONTRACT_PATH,
  validateRunbookSkillContract,
} from "../scripts/runbook-skill-contract.js";

function makeSkill(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "runbook-skill-contract-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(root, relativePath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

function skillMd(frontmatter: string, body = "# Skill\n\nDo the work.") {
  return `---\n${frontmatter.trim()}\n---\n\n${body}\n`;
}

function validContract(overrides: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify(
    {
      version: "1.0.0",
      routing: {
        explicitAliases: ["crm dashboard"],
        triggerExamples: ["Build a CRM dashboard for this account set."],
        confidenceHints: ["The user asks for a CRM dashboard."],
      },
      confirmation: {
        title: "Build CRM Dashboard",
        summary:
          "Discover data, analyze risk, produce an artifact, and validate it.",
        expectedOutputs: ["Interactive dashboard artifact"],
        phaseSummary: ["Discover", "Analyze", "Produce", "Validate"],
      },
      phases: [
        {
          id: "discover",
          title: "Discover context",
          guidance: "references/discover.md",
          capabilityRoles: ["research"],
          taskSeeds: ["Identify relevant source data."],
        },
      ],
      outputs: [
        {
          id: "dashboard",
          title: "Dashboard",
          type: "artifact",
          description: "Interactive dashboard artifact.",
          asset: "assets/dashboard-schema.json",
        },
      ],
      assets: ["assets/dashboard-schema.json"],
      ...overrides,
    },
    null,
    2,
  );
}

describe("runbook-capable skill contract", () => {
  it("ignores normal skills that are not marked as Computer runbooks", () => {
    const root = makeSkill({
      "SKILL.md": skillMd(`
name: normal-skill
description: A normal context skill.
execution: context
`),
    });

    const result = validateRunbookSkillContract(root);

    expect(result.isRunbookSkill).toBe(false);
    expect(result.contractPath).toBeNull();
    expect(result.issues).toEqual([]);
  });

  it("accepts a valid runbook-capable skill with referenced guidance and assets", () => {
    const root = makeSkill({
      "SKILL.md": skillMd(`
name: crm-dashboard
description: Build an opinionated CRM dashboard.
execution: context
metadata:
  author: thinkwork
  version: "1.0.0"
  thinkwork_kind: computer-runbook
`),
      [RUNBOOK_SKILL_CONTRACT_PATH]: validContract(),
      "references/discover.md": "Discover CRM context.",
      "assets/dashboard-schema.json": '{"type":"object"}',
    });

    const result = validateRunbookSkillContract(root);

    expect(result).toMatchObject({
      slug: "crm-dashboard",
      isRunbookSkill: true,
      contractPath: RUNBOOK_SKILL_CONTRACT_PATH,
      issues: [],
    });
  });

  it("fails when a marked runbook skill is missing the contract file", () => {
    const root = makeSkill({
      "SKILL.md": skillMd(`
name: crm-dashboard
description: Build an opinionated CRM dashboard.
execution: context
metadata:
  thinkwork_kind: computer-runbook
`),
    });

    const result = validateRunbookSkillContract(root);

    expect(result.isRunbookSkill).toBe(true);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "missing-contract",
        path: RUNBOOK_SKILL_CONTRACT_PATH,
      }),
    ]);
  });

  it("fails before reading a custom contract path outside the skill", () => {
    const root = makeSkill({
      "SKILL.md": skillMd(`
name: crm-dashboard
description: Build an opinionated CRM dashboard.
execution: context
metadata:
  thinkwork_kind: computer-runbook
  thinkwork_runbook_contract: ../outside.json
`),
    });

    const result = validateRunbookSkillContract(root);

    expect(result.isRunbookSkill).toBe(true);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "invalid-contract-shape",
        path: "../outside.json",
      }),
    ]);
  });

  it("fails when the contract references a missing phase or asset file", () => {
    const root = makeSkill({
      "SKILL.md": skillMd(`
name: crm-dashboard
description: Build an opinionated CRM dashboard.
execution: context
metadata:
  thinkwork_kind: computer-runbook
`),
      [RUNBOOK_SKILL_CONTRACT_PATH]: validContract(),
    });

    const result = validateRunbookSkillContract(root);

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing-reference",
          path: `${RUNBOOK_SKILL_CONTRACT_PATH}:references/discover.md`,
        }),
        expect.objectContaining({
          code: "missing-reference",
          path: `${RUNBOOK_SKILL_CONTRACT_PATH}:assets/dashboard-schema.json`,
        }),
      ]),
    );
  });

  it("fails when a phase requests an unknown capability role", () => {
    const root = makeSkill({
      "SKILL.md": skillMd(`
name: crm-dashboard
description: Build an opinionated CRM dashboard.
execution: context
metadata:
  thinkwork_kind: computer-runbook
`),
      [RUNBOOK_SKILL_CONTRACT_PATH]: validContract({
        phases: [
          {
            id: "discover",
            title: "Discover context",
            guidance: "references/discover.md",
            capabilityRoles: ["research", "terraform_apply"],
            taskSeeds: ["Identify relevant source data."],
          },
        ],
      }),
      "references/discover.md": "Discover CRM context.",
      "assets/dashboard-schema.json": '{"type":"object"}',
    });

    const result = validateRunbookSkillContract(root);

    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "unknown-capability-role",
        message: 'unknown runbook capability role "terraform_apply"',
      }),
    ]);
  });
});
