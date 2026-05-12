import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadRunbookFromDirectory,
  loadRunbooks,
  resolveDefaultRunbooksRoot,
} from "../loader.js";
import { RunbookValidationError } from "../schema.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmRf(dir);
  }
});

describe("runbook loader", () => {
  it("loads a valid runbook-capable skill and attaches phase Markdown", () => {
    const dir = createRunbookSkillDirectory("valid-runbook");
    writeSkillMd(dir, "valid-runbook");
    writeRunbookContract(dir, "valid-runbook", [
      { id: "discover", guidance: "references/discover.md", dependsOn: [] },
      {
        id: "produce",
        guidance: "references/produce.md",
        dependsOn: ["discover"],
      },
    ]);
    writeReference(dir, "discover.md", "# Discover\n\nFind the inputs.");
    writeReference(dir, "produce.md", "# Produce\n\nCreate the artifact.");

    const runbook = loadRunbookFromDirectory(dir);

    expect(runbook.slug).toBe("valid-runbook");
    expect(runbook.phases.map((phase) => phase.id)).toEqual([
      "discover",
      "produce",
    ]);
    expect(runbook.phases[0]?.guidanceMarkdown).toContain("Find the inputs");
  });

  it("fails when a referenced phase Markdown file is missing", () => {
    const dir = createRunbookSkillDirectory("missing-markdown");
    writeSkillMd(dir, "missing-markdown");
    writeRunbookContract(dir, "missing-markdown", [
      { id: "discover", guidance: "references/discover.md", dependsOn: [] },
    ]);

    expect(() => loadRunbookFromDirectory(dir)).toThrow(RunbookValidationError);
    try {
      loadRunbookFromDirectory(dir);
    } catch (err) {
      expect((err as RunbookValidationError).issues[0]).toContain(
        'phase "discover" guidance file "references/discover.md" was not found',
      );
    }
  });

  it("loads runbook-capable skills from a catalog root in slug order", () => {
    const root = mkdtempSync(join(tmpdir(), "runbook-root-"));
    tempDirs.push(root);
    for (const slug of ["zeta-runbook", "alpha-runbook"]) {
      const dir = join(root, slug);
      mkdirSync(join(dir, "references"), { recursive: true });
      writeSkillMd(dir, slug);
      writeRunbookContract(dir, slug, [
        { id: "discover", guidance: "references/discover.md", dependsOn: [] },
      ]);
      writeReference(dir, "discover.md", "# Discover");
    }
    const normal = join(root, "normal-skill");
    mkdirSync(normal, { recursive: true });
    writeFileSync(
      join(normal, "SKILL.md"),
      "---\nname: normal-skill\ndescription: x\n---\n\n# Normal\n",
    );

    expect(loadRunbooks(root).map((runbook) => runbook.slug)).toEqual([
      "alpha-runbook",
      "zeta-runbook",
    ]);
  });

  it("resolves bundled Lambda skill catalog next to the entrypoint", () => {
    const root = mkdtempSync(join(tmpdir(), "runbook-bundle-"));
    tempDirs.push(root);
    mkdirSync(join(root, "skill-catalog"), { recursive: true });

    expect(
      resolveDefaultRunbooksRoot(
        pathToFileURL(join(root, "index.mjs")).toString(),
      ),
    ).toEqual(pathToFileURL(join(root, "skill-catalog")));
  });
});

function createRunbookSkillDirectory(slug: string) {
  const dir = mkdtempSync(join(tmpdir(), `${slug}-`));
  tempDirs.push(dir);
  mkdirSync(join(dir, "references"), { recursive: true });
  return dir;
}

function writeReference(dir: string, filename: string, content: string) {
  writeFileSync(join(dir, "references", filename), content);
}

function writeSkillMd(dir: string, slug: string) {
  writeFileSync(
    join(dir, "SKILL.md"),
    [
      "---",
      `name: ${slug}`,
      "display_name: Test Runbook",
      "description: Test runbook.",
      "category: dashboard",
      "version: 0.1.0",
      "execution: context",
      "metadata:",
      "  thinkwork_kind: computer-runbook",
      "  thinkwork_runbook_contract: references/thinkwork-runbook.json",
      "---",
      "",
      "# Test Runbook",
      "",
    ].join("\n"),
  );
}

function writeRunbookContract(
  dir: string,
  slug: string,
  phases: Array<{ id: string; guidance: string; dependsOn: string[] }>,
) {
  writeFileSync(
    join(dir, "references", "thinkwork-runbook.json"),
    JSON.stringify(
      {
        version: "1.0.0",
        sourceVersion: "0.1.0",
        routing: {
          explicitAliases: ["test runbook"],
          triggerExamples: ["Run the test runbook."],
          confidenceHints: ["The prompt asks for a test."],
        },
        inputs: [],
        confirmation: {
          title: "Test",
          summary: "Run the test.",
          expectedOutputs: ["Test output"],
          likelyTools: [],
          phaseSummary: ["Test phase."],
        },
        phases: phases.map((phase) => ({
          id: phase.id,
          title: phase.id,
          guidance: phase.guidance,
          capabilityRoles: ["research"],
          dependsOn: phase.dependsOn,
          taskSeeds: ["Test task."],
        })),
        outputs: [
          {
            id: "test_output",
            title: "Test output",
            type: "artifact",
            description: "Test output.",
          },
        ],
        overrides: {
          allowedFields: ["catalog.description"],
        },
      },
      null,
      2,
    ),
  );
}

function rmRf(path: string) {
  rmSync(path, { recursive: true, force: true });
}
