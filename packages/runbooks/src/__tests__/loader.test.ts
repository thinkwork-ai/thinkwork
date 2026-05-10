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
  it("loads a valid runbook and attaches phase Markdown", () => {
    const dir = createRunbookDirectory("valid-runbook");
    writeRunbookYaml(dir, "valid-runbook", [
      { id: "discover", guidance: "discover.md", dependsOn: [] },
      { id: "produce", guidance: "produce.md", dependsOn: ["discover"] },
    ]);
    writePhase(dir, "discover.md", "# Discover\n\nFind the inputs.");
    writePhase(dir, "produce.md", "# Produce\n\nCreate the artifact.");

    const runbook = loadRunbookFromDirectory(dir);

    expect(runbook.slug).toBe("valid-runbook");
    expect(runbook.phases.map((phase) => phase.id)).toEqual([
      "discover",
      "produce",
    ]);
    expect(runbook.phases[0]?.guidanceMarkdown).toContain("Find the inputs");
  });

  it("fails when a phase Markdown file is missing", () => {
    const dir = createRunbookDirectory("missing-markdown");
    writeRunbookYaml(dir, "missing-markdown", [
      { id: "discover", guidance: "discover.md", dependsOn: [] },
    ]);

    expect(() => loadRunbookFromDirectory(dir)).toThrow(RunbookValidationError);
    try {
      loadRunbookFromDirectory(dir);
    } catch (err) {
      expect((err as RunbookValidationError).issues[0]).toContain(
        'phase "discover" guidance file "discover.md" was not found',
      );
    }
  });

  it("loads runbooks from a root directory in slug order", () => {
    const root = mkdtempSync(join(tmpdir(), "runbook-root-"));
    tempDirs.push(root);
    for (const slug of ["zeta-runbook", "alpha-runbook"]) {
      const dir = join(root, slug);
      mkdirSync(join(dir, "phases"), { recursive: true });
      writeRunbookYaml(dir, slug, [
        { id: "discover", guidance: "discover.md", dependsOn: [] },
      ]);
      writePhase(dir, "discover.md", "# Discover");
    }

    expect(loadRunbooks(root).map((runbook) => runbook.slug)).toEqual([
      "alpha-runbook",
      "zeta-runbook",
    ]);
  });

  it("resolves bundled Lambda runbooks next to the entrypoint", () => {
    const root = mkdtempSync(join(tmpdir(), "runbook-bundle-"));
    tempDirs.push(root);
    mkdirSync(join(root, "runbooks"), { recursive: true });

    expect(
      resolveDefaultRunbooksRoot(
        pathToFileURL(join(root, "index.mjs")).toString(),
      ),
    ).toEqual(pathToFileURL(join(root, "runbooks")));
  });
});

function createRunbookDirectory(slug: string) {
  const dir = mkdtempSync(join(tmpdir(), `${slug}-`));
  tempDirs.push(dir);
  mkdirSync(join(dir, "phases"), { recursive: true });
  return dir;
}

function writePhase(dir: string, filename: string, content: string) {
  writeFileSync(join(dir, "phases", filename), content);
}

function writeRunbookYaml(
  dir: string,
  slug: string,
  phases: Array<{ id: string; guidance: string; dependsOn: string[] }>,
) {
  writeFileSync(
    join(dir, "runbook.yaml"),
    [
      `slug: ${slug}`,
      "version: 0.1.0",
      "catalog:",
      "  displayName: Test Runbook",
      "  description: Test runbook.",
      "  category: dashboard",
      "routing:",
      "  explicitAliases:",
      "    - test runbook",
      "  triggerExamples:",
      "    - Run the test runbook.",
      "  confidenceHints:",
      "    - The prompt asks for a test.",
      "inputs: []",
      "approval:",
      "  title: Test",
      "  summary: Run the test.",
      "  expectedOutputs:",
      "    - Test output",
      "  likelyTools: []",
      "  phaseSummary:",
      "    - Test phase.",
      "phases:",
      ...phases.flatMap((phase) => [
        `  - id: ${phase.id}`,
        `    title: ${phase.id}`,
        `    guidance: ${phase.guidance}`,
        "    capabilityRoles:",
        "      - research",
        `    dependsOn: [${phase.dependsOn.join(", ")}]`,
        "    taskSeeds:",
        "      - Test task.",
      ]),
      "outputs:",
      "  - id: test_output",
      "    title: Test output",
      "    type: artifact",
      "    description: Test output.",
      "overrides:",
      "  allowedFields:",
      "    - catalog.description",
    ].join("\n"),
  );
}

function rmRf(path: string) {
  rmSync(path, { recursive: true, force: true });
}
