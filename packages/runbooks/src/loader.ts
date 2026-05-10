import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  RunbookValidationError,
  type RunbookDefinition,
  validateRunbookDefinition,
} from "./schema.js";

export const defaultRunbooksRoot = fileURLToPath(resolveDefaultRunbooksRoot());

export function resolveDefaultRunbooksRoot(importMetaUrl = import.meta.url) {
  const sourceRoot = fileURLToPath(new URL("../runbooks", importMetaUrl));
  const bundledRoot = fileURLToPath(new URL("./runbooks", importMetaUrl));

  if (existsSync(sourceRoot)) return new URL("../runbooks", importMetaUrl);
  if (existsSync(bundledRoot)) return new URL("./runbooks", importMetaUrl);
  return new URL("../runbooks", importMetaUrl);
}

export function loadRunbookFromDirectory(directory: string): RunbookDefinition {
  const yamlPath = join(directory, "runbook.yaml");
  if (!existsSync(yamlPath)) {
    throw new RunbookValidationError("Invalid runbook definition", [
      `missing runbook.yaml at ${yamlPath}`,
    ]);
  }

  const parsed = parse(readFileSync(yamlPath, "utf8"));
  const runbook = validateRunbookDefinition(parsed);
  const issues: string[] = [];
  const phases = runbook.phases.map((phase) => {
    const guidancePath = join(directory, "phases", phase.guidance);
    if (!existsSync(guidancePath)) {
      issues.push(
        `phase "${phase.id}" guidance file "${phase.guidance}" was not found`,
      );
      return phase;
    }
    return {
      ...phase,
      guidanceMarkdown: readFileSync(guidancePath, "utf8"),
    };
  });

  if (issues.length > 0) {
    throw new RunbookValidationError("Invalid runbook definition", issues);
  }

  return { ...runbook, phases };
}

export function loadRunbooks(root = defaultRunbooksRoot) {
  if (!existsSync(root)) return [];
  const directories = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .sort();
  return directories.map((directory) => loadRunbookFromDirectory(directory));
}
